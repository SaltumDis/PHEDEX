package PHEDEX::File::Remove::Agent;
use strict;
use warnings;
use base 'PHEDEX::Core::Agent';
use File::Path;
use Data::Dumper;

use PHEDEX::Core::Command;
use PHEDEX::Core::Timing;
use PHEDEX::Core::Catalogue;
use PHEDEX::Core::DB;
use PHEDEX::Core::JobManager;

sub new
{
    my $proto = shift;
    my $class = ref($proto) || $proto;
    my $self = $class->SUPER::new(@_);

    my %params = (DBCONFIG => undef,		# Database configuration file
	  	  NODES    => undef,		# Node names to run this agent for
		  WAITTIME => 60 + rand(15),	# Agent activity cycle
		  CMD_RM   => undef,            # cmd to remove physical files
		  PROTOCOL => 'direct',         # File access protocol
		  CATALOGUE => {},		# TFC from TMDB
		  LIMIT => 100,                 # Max number of files per cycle
		  JOBS	=> 1,			# Max parallel delete jobs
		  RETRY => 1,			# Retry failed attempts, forever!
		  );
    
    my %args = (@_);
    foreach ( keys %params )
    {
      $self->{$_} = defined($args{$_}) ? $args{$_} : $params{$_};
    }

    # Create a JobManager
    $self->{JOBMANAGER} = PHEDEX::Core::JobManager->new (
						NJOBS	=> $self->{JOBS},
						VERBOSE	=> $self->{VERBOSE},
						DEBUG	=> $self->{DEBUG},
							);

    # Handle signals
    $SIG{INT} = $SIG{TERM} = sub { $self->{SIGNALLED} = shift;
				   $self->{JOBMANAGER}->killAllJobs() };

#   Finagle the WAITTIME so I can speed up deletions if the queue is full
    $self->{WAITTIME_SLOW} = $self->{WAITTIME};
    $self->{WAITTIME_FAST} = 2;

    bless $self, $class;
    return $self;
}

# Delete a file.  We do one step at a time; if the step fails, we just
# tell the caller to come back here again at a more opportune time.
# The steps are ordered such that they are safe to execute several
# times if we have to give for one reason or another.
sub deleteOneFile
{
    my ($self, $drop, $file) = @_;
    my $dbh = undef;
    my @nodes = ();

    my $status = eval {
	$dbh = $self->connectAgent();
	@nodes = $self->expandNodes();

	# Get Buffer Node if this is for an MSS node.  We will check
	# transfers for the buffer node along with the MSS node, and
	# delete replicas for the buffer node as well as the MSS node.
	# We will only mark the deletion done for the MSS node
	# however.
	# TODO:  Make this feature naming-convention independent
	my %node_binds = (':node1' => $$file{NODEID});
	if ($$file{NODE} =~ /_MSS$/) {
	    my $buffer = $$file{NODE};
	    $buffer =~ s/_MSS$/_Buffer/;
	    my ($buffer_id) = &dbexec($dbh, qq{ select id from t_adm_node where name = :buffer },
				      ':buffer' => $buffer)->fetchrow();
	    $node_binds{':node2'} = $buffer_id if $buffer_id;
	}
	my $node_list = join(',', keys %node_binds);

	
	# Make sure the file is still safe to delete.  More transfers
	# out might have been created for this file while we were not
	# minding this particular file (sleeping or deleting things).
	my ($npending) = &dbexec($dbh, qq{
	    select count(fileid) from t_xfer_task xt
 	     where xt.from_node in ($node_list)
	      and xt.fileid = :fileid },
	    %node_binds,
	    ":fileid" => $$file{FILEID})
	    ->fetchrow();

	if ($npending)
	{
	    $self->Warn ("not removing $$file{LFN}, $npending pending transfers") if !$self->{_drops}{$drop};
	    return 0;
	}

	$self->{_drops}{$drop}++;
	# Now delete the replica entry to avoid new transfer edges.
	&dbexec($dbh, qq{
	    delete from t_xfer_replica where fileid = :fileid and node in ($node_list)},
	    ":fileid" => $$file{FILEID}, %node_binds);

	$$file{DROP} = $drop; # We will need this in the JobManager callback

	# Issue file removal from disk now.
	my $log = "$$self{DROPDIR}/$$file{NODEID}.$$file{FILEID}.log";
	$self->{JOBMANAGER}->addJob( sub { $self->deleteJob ($file, @_) },
		       { TIMEOUT => 30, LOGFILE => $log, DB => $dbh },
		       (@{$$self{CMD_RM}}, 'post', $$file{PFN}) );
	return 1;
    };

    do { chomp ($@); $self->Alert ("database error: $@");
	 eval { $dbh->rollback() } if $dbh;
	 $status = 0 } if $@;
    
    # Return status code to caller
    return $status;
}

sub deleteJob
{
    my ($self, $file, $job) = @_;
    if ($$job{STATUS})
    {
	$self->Warn("failed to delete file $$file{PFN} at node "
	      ."$$file{NODE}, log in $$job{LOGFILE}");
    }
    if ( !$job->{STATUS} || !$self->{RETRY} )
    {
        if ( !$job->{STATUS} )
        {
	    $self->Logmsg("deleted file $$file{PFN} at node $$file{NODE}");
	    unlink ($$job{LOGFILE});
	}
        if ( $job->{STATUS} && !$self->{RETRY} )
        {
	    $self->Logmsg("giving up on file $$file{PFN} at node $$file{NODE}");
	}
        delete $self->{_drops}{$file->{DROP}};

        my $dbh = undef;
        my $status = eval {
	  $dbh = $self->connectAgent();
#	  @nodes = $self->expandNodes();
	  # Report completition time to DB. If the physical deletion fails,
	  # we will roll back.
	  my $now = &mytimeofday();
	  &dbexec($dbh, qq{
	    update t_xfer_delete set time_complete = :now
		where fileid = :fileid and node = :node},
		":fileid" => $$file{FILEID}, ":node" => $$file{NODEID}, ":now" => $now);
        };
	$dbh->commit(); # don't hold this row lock for long.

        do { chomp ($@); $self->Alert ("database error: $@");
	  eval { $dbh->rollback() } if $dbh;
	  return; } if $@;

	# Mark drop done so it will be nuked
        my $dropdir = "$$self{WORKDIR}/$$file{DROP}";
	&touch ("$dropdir/done");

	# Log transfer delay stats
	my $dtransfer = &mytimeofday() - $$file{TIME_START};
	$self->Logmsg ("xstats: $$file{NODE} " . sprintf('%.2fs', $dtransfer)
	     . " $$file{LFN} => $$file{PFN}");

	# OK, got far enough to nuke and log it
	$self->Logmsg("Delete drop $file->{DROP} ($file->{LFN})") if $self->{DEBUG};
	$self->relayDrop ($$file{DROP});
    }
}

sub processDrop
{
    my ($self, $drop) = @_;
    # Sanity checking
    return if (! $self->inspectDrop ($drop));
    delete $$self{BAD}{$drop};
    &timeStart($$self{STARTTIME});

    # Read back file information
    my $dropdir = "$$self{WORKDIR}/$drop";
    my $file = do { no strict "vars"; eval &input ("$dropdir/packet") };
    if ($@ || !$file || !$$file{FILEID} || !$$file{LFN} || !$$file{PFN} || !$$file{TIME_START})
    {
	$self->Alert ("corrupt packet in $drop");
	$self->markBad ($drop);
	return;
    }

    # Try deleting this file.  If something fails, keep this drop as
    # is, we'll come back to it later.
    # Add the drop to the file, so the callback from the JobManager
    # can delete the drop if the file-delete succeeds
    $self->deleteOneFile ($drop, $file);
}

# Get a list of files to delete.
sub filesToDelete
{
    my ($self, $dbh, $limit, $node, $pending) = @_;

    my $now = &mytimeofday();

    # Find all the files that we are allowed to delete: 
    # Get the list of files from t_xfer_delete
    # We take the files oldest first.
    my @result;
    my %files = ();
    my $q = &dbexec($dbh,qq{
	select xd.fileid, xf.logical_name
	from t_xfer_delete xd
	join t_xfer_file xf
	on xd.fileid = xf.id
	where xd.time_complete is null and xd.node = :node
	order by xd.time_request asc},
        ":node" => $$self{NODES_ID}{$node});
    while (my ($id, $lfn) = $q->fetchrow())
    {
	next if grep ($_ eq $id, @{$pending});
	$files{$lfn} = $id;
	if ( scalar keys %files >= $limit )
	{
	  $self->{WAITTIME} = $self->{WAITTIME_FAST};
	  last;
	}
    }
    $q->finish();  # free resources in case we didn't use all results

    # Now get PFNs for all those files.
    my $cat = dbStorageRules($self->{DBH},
			     $self->{CATALOGUE},
			     $self->{NODES_ID}{$node});
    my $pfns;
    foreach ( keys %files )
    {
      $pfns->{$_} = [applyStorageRules
                      (
                        $cat,
                        $self->{PROTOCOL},
                        $self->{NODES_ID}{$node},
                        'pre',
                        $_,
                        'n', # $IS_CUSTODIAL
                      )];
    }

    while (my ($lfn, $pfn2) = each %$pfns)
    {
        my $pfn = $pfn2->[1];
        my $space_token = $pfn2->[0];
	do { $self->Alert ("no pfn for $lfn"); next } if ! $pfn;
	push (@result, { LFN => $lfn, PFN => $pfn, FILEID => $files{$lfn},
			 NODEID => $$self{NODES_ID}{$node}, NODE => $node,
			 TIME_START => &mytimeofday() });
    }

    return @result;
}

# Create a drop for deleting a file.  We create a drop for ourselves,
# i.e. in our own inbox, and then process the file in "processDrop".
# This way we have a permanent record of where we are with deleting
# the file, in case we have to give up some operation for temporary
# failures.
sub startOne
{
    my ($self, $file) = @_;

    # Create a pending drop in my inbox
    my $drop = "$$self{DROPDIR}/inbox/$$file{FILEID}";
    do { $self->Alert ("$drop already exists"); return 0; } if -d $drop;
    do { $self->Alert ("failed to submit $$file{FILEID}"); &rmtree ($drop); return 0; }
	if (! &mkpath ($drop)
	    || ! &output ("$drop/packet", Dumper ($file))
	    || ! &touch ("$drop/go.pending"));

    # OK, kick it go
    $self->Warn ("failed to mark $$file{FILEID} ready to go")
	if ! &mv ("$drop/go.pending", "$drop/go");

    return 1;
}

# Pick up work from the database.
sub idle
{
    my ($self, @pending) = @_;
    my $dbh = undef;
    my @nodes = ();

    $self->{WAITTIME} = $self->{WAITTIME_SLOW};

    my $count=0;
    eval
    {
	$dbh = $self->connectAgent();
	@nodes = $self->expandNodes();

	#   If I am already swamped with work, don't get more!
	if ( $self->{JOBMANAGER}->jobsQueued() > $self->{LIMIT} )
	{
	    $self->Warn("number of queued jobs (",$self->{JOBMANAGER}->jobsQueued(),
			") exceeds work-limit per cycle (",$self->{LIMIT},"). Waiting...");
	    return; # exit eval block
	}

	# Get a list of victims to evict.
	foreach my $node (@nodes)
	{
	    foreach my $file ($self->filesToDelete ($dbh, $$self{LIMIT}, $node, \@pending))
	    {
		# If we are already processing this file, ignore it
		next if grep ($_ eq $$file{FILEID}, @pending);
		
		# Otherwise initiate destruction and doom
		$self->startOne ($file);
		$count++;
	    }
	    # Intermediate commit after having dealt with all files at a node
	    $dbh->commit();
	}
    };
    do { chomp ($@); $self->Alert ("database error: $@");
	 eval { $dbh->rollback() } if $dbh } if $@;
    $self->{WAITTIME} = $self->{WAITTIME_SLOW} unless $count;
    $self->Logmsg("Started $count jobs with " . scalar @pending . " pending") if $count;

    # Disconnect from the database
    $self->{JOBMANAGER}->whenQueueDrained( sub { $self->disconnectAgent(); } );
}

sub reloadConfig
{
  my ($self,$Config) = @_;
  my $config = $Config->select_agents($self->{LABEL});
  my $val;
  foreach ( qw / LIMIT VERBOSE DEBUG WAITTIME_SLOW / )
  {
    next unless defined ($val = $config->{OPTIONS}{$_});
    $self->Logmsg("reloadConfig: set $_=$val");
    $self->{$_} = $val;
  }
  $val = $config->{OPTIONS}{JOBS};
  if ( defined($val) )
  {
    $self->Logmsg("reloadConfig: set NJOBS=$val in my JobManager");
    $self->{JOBMANAGER}{NJOBS} = $val;
  }
} 

1;
