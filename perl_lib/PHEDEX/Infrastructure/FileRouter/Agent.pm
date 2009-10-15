package PHEDEX::Infrastructure::FileRouter::Agent;
use strict;
use warnings;
use base 'PHEDEX::Core::Agent', 'PHEDEX::Core::Logging';
use List::Util qw(max);
use PHEDEX::Core::Timing;
use PHEDEX::Core::DB;
use PHEDEX::Error::Constants;

use constant TERABYTE => 1024**4;
use constant GIGABYTE => 1024**3;
use constant MEGABYTE => 1024**2;

sub new
{
    my $proto = shift;
    my $class = ref($proto) || $proto;
    my $self = $class->SUPER::new(@_);
    my %params = (DBCONFIG => undef,		# Database configuration file
		  MYNODE => undef,		# My node name
		  WAITTIME => 60 + rand(10),	# Agent activity cycle
		  FLUSH_MARKER => undef,	# Current slow flush marker
		  FLUSH_PERIOD => 1800,		# Frequency of slow flush
		  NEXT_STATS => 0,		# Next time to refresh stats
		  NEXT_SLOW_FLUSH => 0,	        # Next time to flush
		  WINDOW_SIZE => 10,            # Size of priority windows in TB
		  REQUEST_ALLOC => 'BY_AGE',    # Method to use when allocating file requests
		  ME	=> 'FileRouter',
		  );
    my %args = (@_);
    map { $$self{$_} = $args{$_} || $params{$_} } keys %params;
    $$self{WINDOW_SIZE} *= TERABYTE;
    if ($$self{REQUEST_ALLOC} eq 'BY_AGE') {
	$$self{REQUEST_ALLOC_SUBREF} = \&getDestinedBlocks_ByAge;
    } elsif ($$self{REQUEST_ALLOC} eq 'DATASET_BALANCE') {
	$$self{REQUEST_ALLOC_SUBREF} = \&getDestinedBlocks_DatasetBalance;
    } else {
	die "Request allocation method '$$self{REQUEST_ALLOC}' not known, use -h for help.\n";
    }
    bless $self, $class;
    return $self;
}

# Called by agent main routine before sleeping.  Pick up work
# assignments from the database here and pass them to slaves.
sub idle
{
    my ($self, @pending) = @_;
    my $dbh = undef;
    my @nodes;

    eval
    {
	$$self{NODES} = [ '%' ];
	$dbh = $self->connectAgent();
	@nodes = $self->expandNodes();

	# Run general flush.
	$self->flush($dbh);

	# Route files.
	$self->route($dbh);

	# Print any warnings.
	$self->warn_route_failures();

	# Perhaps update statistics.
	$self->stats($dbh);
    };
    do { chomp ($@); $self->Alert ("database error: $@");
	 eval { $dbh->rollback() } if $dbh; } if $@;

    # Disconnect from the database and reset flush marker
    $self->disconnectAgent();
    $$self{FLUSH_MARKER} = undef;
}

# Run general system flush.
sub flush
{
    my ($self, $dbh) = @_;
    my $now = &mytimeofday();

    return if $now < $$self{NEXT_SLOW_FLUSH};

    # Get the current value of marker from file pump.
    my $markerval = (defined $$self{FLUSH_MARKER} ? "currval" : "nextval");
    ($$self{FLUSH_MARKER}) = &dbexec($dbh, qq{
	select seq_xfer_done.$markerval from dual})
	->fetchrow();

    my @stats;
    # Update priority on existing requests.
    my ($stmt, $rows) = &dbexec ($dbh, qq{
	update (select xq.priority req_priority, bd.priority cur_priority
		from t_xfer_request xq
		  join t_dps_block_dest bd
		    on bd.block = xq.inblock
		    and bd.destination = xq.destination
		where xq.priority != bd.priority)
	set req_priority = cur_priority});
    push @stats, ['request priority updated', $rows];

    # Clear requests for files no longer wanted.
    ($stmt, $rows) = &dbexec($dbh, qq{
	delete from t_xfer_request xq where not exists
	  (select 1 from t_dps_block_dest bd
	   where bd.destination = xq.destination
	     and bd.block = xq.inblock
	     and bd.state = 1)});
    push @stats, ['unwanted requests deleted', $rows];

    my $ndel = 0;
    # Clear requests where replica exists.  This is required
    # because the request activation from block destination
    # creates requests for files for which replica may exist.
    ($stmt, $rows) = &dbexec($dbh, qq{
	delete from t_xfer_request xq
	 where exists
	   (select 1 from t_xfer_replica xr
	     where xr.fileid = xq.fileid
	    and xr.node = xq.destination)});
    push @stats, ['deleted requests with replica', $rows];
    do { $dbh->commit(); $ndel = 0 } if (($ndel += $rows) >= 10_000);


    # Clear old paths and those missing an active request.
    # Clear invalid expired paths.
    # Clear valid paths, that expired more than 8 hours ago.
    # Ensure paths are not broken in the proccess.
    ($stmt, $rows) = &dbexec($dbh, qq{
	    delete from t_xfer_path xp where (xp.fileid, xp.src_node, xp.destination) in (
	      select fileid, src_node, destination from (
		select ixp.fileid, ixp.src_node, ixp.destination,
		       count(*) total,
		  sum (case
		       when xq.fileid is null or xq.state != 0 then 1 --request is invalid
		       when ixp.is_valid = 1
			    and :now > ixp.time_expire + 8*3600 then 1 --valid path expired 8+ hours ago
		       when ixp.is_valid = 0 and :now >= ixp.time_expire then 1 -- invalid path expired
		       else 0
		       end) delete_path
		from t_xfer_path ixp
		left join t_xfer_request xq
		     on xq.fileid = ixp.fileid and xq.destination = ixp.destination
	       group by ixp.fileid, ixp.src_node, ixp.destination
	      ) where delete_path != 0 -- any path segment invalid, delete
	    ) }, ":now" => $now, ":now" => $now);
    push @stats, ['invalid paths deleted', $rows];
    do { $dbh->commit(); $ndel = 0 } if (($ndel += $rows) >= 10_000);

    # Set the path go again for issuer.
    ($stmt, $rows) = &dbexec($dbh, qq{ delete from t_xfer_exclude });
    push @stats, ['exclusions deleted', $rows];
    $ndel += $rows;
    $dbh->commit() if $ndel;

    # If transfers path are about to expire on links which have
    # reasonable recent transfer rate (1 kBps), give a bit more grace time.
    # Be sure to extend the entire path from src_node to destination
    # so that paths are not broken on cleanup.  Ignore local links.
    my %extend;
    my $qextend = &dbexec($dbh, qq{
	select xp.fileid, xp.destination, xp.from_node, xp.to_node
	from t_xfer_path xp
        join t_adm_link l on l.to_node = xp.to_node
                         and l.from_node = xp.from_node
        join t_adm_link_param lp on lp.to_node = l.to_node
                                and lp.from_node = l.from_node
	where xp.time_expire >= :now
	  and xp.time_expire < :now + 2*3600
	  and xp.is_valid = 1
          and l.is_local = 'n'
	  and lp.xfer_rate >= 1048576 },
	":now" => $now);
    while (my ($file, $dest, $from, $to) = $qextend->fetchrow())
    {
	push(@{$extend{':time_expire'}}, $now + 6*3600 + rand(6*3600));
	push(@{$extend{':to'}}, $to);
	push(@{$extend{':dest'}}, $dest);
	push(@{$extend{':fileid'}}, $file);
    }

    if (%extend)
    {
	# Array binds can't handle named parameters
	my %by_dest = (1 => $extend{':time_expire'},
		       2 => $extend{':dest'},
		       3 => $extend{':fileid'});
	my %by_to   = (1 => $extend{':time_expire'},
		       2 => $extend{':to'},
		       3 => $extend{':fileid'});
	($stmt, $rows) = &dbexec($dbh, qq{
	    update t_xfer_path set time_expire = ?
	    where destination = ? and fileid = ?},
	    %by_dest);
	push @stats, ['path expire extended', $rows];
	($stmt, $rows) = &dbexec($dbh, qq{
	    update t_xfer_task set time_expire = ?
	    where to_node = ? and fileid = ?},
	    %by_to);
	push @stats, ['task expire extended', $rows];
	($stmt, $rows) = &dbexec($dbh, qq{
	    update t_xfer_request set time_expire = ?
	    where destination = ? and fileid = ?},
	    %by_dest);
	push @stats, ['request expire extended', $rows];
    }

    # Mark as expired tasks which didn't complete in time.
    ($stmt, $rows) = &dbexec($dbh, qq{
	merge into t_xfer_task_done xtd using
	  (select id from t_xfer_task where :now >= time_expire) xt
	on (xtd.task = xt.id) when not matched then
	  insert (task, report_code, xfer_code, time_xfer, time_update)
	  values (xt.id, @{[ PHEDEX_RC_EXPIRED ]}, @{[ PHEDEX_XC_NOXFER ]}, -1, :now)},
	":now" => $now);
    push @stats, ['tasks expired', $rows];

    # Deactivate requests which reached their expire time limit.
    ($stmt, $rows) = &dbexec($dbh, qq{
	update t_xfer_request
	set state = 1, time_expire = :now + dbms_random.value(1,3)*3600
	where state = 0 and :now >= time_expire},
	":now" => $now);
    push @stats, ['expired requests deactivated', $rows];

    # Commit the lot above.
    $dbh->commit();

    # Log flush statistics
    $self->Logmsg('executed flush:  '.join(', ', map { $$_[1] + 0 .' '.$$_[0] } @stats));

    # Schedule the next flush
    $$self{NEXT_SLOW_FLUSH} = $now + $$self{FLUSH_PERIOD};
}

sub route
{
    my ($self, $dbh) = @_;

    # All of this must run in a single agent to avoid database
    # connection proliferation.  The execution order for the
    # phases is important in that it balances progress for this
    # node (destination) and requests by other nodes (relaying).
    # Some of the steps feed to the next one.
    #
    # New requests begin in open state.  Offers will then begin to
    # build.  Once first offer reaches the destination, we mark
    # the request to go active in twice the time elapsed from the
    # opening.  Once a request is active, we confirm the path that
    # Has least total cost.
    #
    # Consider running only one instance of this agent for all
    # nodes.  If the agent passes one loop quickly enough, this
    # will reduce number of connections and database load
    # significantly.

    # Read links and their parameters.  Only consider links which
    # are "alive", i.e. have a live download agent at destination
    # and an export agent at the source.
    my $links = {};
    my $q = &dbexec($dbh, qq{
	select l.from_node, l.to_node, l.distance, l.is_local, l.is_active,
	       p.xfer_rate, p.xfer_latency,
	       xso.protocols, xsi.protocols
	from t_adm_link l
	  join t_adm_node ns on ns.id = l.from_node
	  join t_adm_node nd on nd.id = l.to_node
	  left join t_adm_link_param p
	    on p.from_node = l.from_node
	    and p.to_node = l.to_node
	  left join t_xfer_source xso
	    on xso.from_node = ns.id
	    and xso.to_node = nd.id
	    and xso.time_update >= :recent
	  left join t_xfer_sink xsi
	    on xsi.from_node = ns.id
	    and xsi.to_node = nd.id
	    and xsi.time_update >= :recent
	where l.is_active = 'y'
	  and ((ns.kind = 'MSS' and nd.kind = 'Buffer')
	   or (ns.kind = 'Buffer' and nd.kind = 'MSS'
	       and xsi.from_node is not null)
	   or (xso.from_node is not null
	       and xsi.from_node is not null))},
	":recent" => &mytimeofday() - 5400);

    my %active_nodes;  # hash for uniqueness
    while (my ($from, $to, $hops, $local, $is_active, $rate, $latency,
	       $src_protos, $dest_protos) = $q->fetchrow())
    {
	$active_nodes{$to} = 1;
	$$links{$from}{$to} = { HOPS => $hops,
				IS_ACTIVE => $is_active,
				IS_LOCAL => $local eq 'y' ? 1 : 0,
				XFER_RATE => $rate,
				XFER_LATENCY => $latency,
				FROM_PROTOS => $src_protos,
				TO_PROTOS => $dest_protos };
    }
    my @active_nodes = sort keys %active_nodes;

    # Now route for the nodes
    my %node_names = reverse %{$$self{NODES_ID}};
    my $active_node_list = join ' ', sort @node_names{@active_nodes};
    $self->prepare ($dbh, $_) for (@active_nodes);
    $self->routeFiles ($dbh, $links, @active_nodes)
	|| $self->Logmsg ("no files to route to $active_node_list");
}

# Run the routing algorithm for one node.
sub prepare
{
    my ($self, $dbh, $node) = @_;

    ######################################################################
    # Phase 1: Issue file requests for blocks pending some of their files.
    #
    # In this phase, we create file requests and implement the first
    # step of the priority model.  In this model we have N windows of
    # priority each of which can be filled up to WINDOW_SIZE bytes of
    # requests.  The requests are allocated by block, so it is
    # important that block sizes are typically much less than the
    # WINDOW_SIZE.  The order in which blocks are activated into file
    # requests is determined by a command-line argument.  See the
    # getDestinedBlocks_* functions below to see what the options are.

    # Get current level of through traffic
    my $now = &mytimeofday();
    my $q_not_for_me = &dbexec($dbh, qq{
	select nvl(sum(xf.filesize),0)
	from t_xfer_path xp
	  join t_xfer_file xf
	    on xf.id = xp.fileid
	  left join t_xfer_request xq
	    on xq.fileid = xp.fileid
	    and xq.destination = xp.to_node
	where xp.to_node = :node
	  and xq.fileid is null },
       ":node" => $node);
    my ($not_for_me) = $q_not_for_me->fetchrow() || 0;

    # Get current level of requests by priority
    my %priority_windows = map { ($_ => 0) } 0..100; # 100 levels of priority available
    my $q_current_requests = &dbexec($dbh, qq{
	select xq.priority, sum(xf.filesize)
          from t_xfer_request xq 
          join t_xfer_file xf on xf.id = xq.fileid
	 where xq.destination = :node
         group by xq.priority },
     ":node" => $node);

    while (my ($priority, $bytes) = $q_current_requests->fetchrow())
    {
	$priority_windows{$priority} += $bytes;
    }

    # Fill priority windows up to WINDOW_SIZE each if through traffic
    # is not more than WINDOW_SIZE
    if ($not_for_me <= $$self{WINDOW_SIZE})
    {
	# Find block destinations we can activate, requiring that
	# the block fit into the priority window.  Note that open
	# blocks can grow beyond the window limits if new files
	# are added.  New file additions are added to the
	# t_xfer_request table via a trigger. We keep adding blocks
	# until the priority window is full or we are out of
	# wanted blocks.

	# Get blocks to activate according to the allocation model we are using
	my $blocks_to_activate = &{ $$self{REQUEST_ALLOC_SUBREF} }($dbh, $node);

	# Activate blocks up to the WINDOW_SIZE limit
	my $u = &dbprep($dbh, qq{
	    update t_dps_block_dest
		set state = 1, time_active = :now
		where block = :block and destination = :node});
	my @activated_blocks;
	foreach my $b (@{ $blocks_to_activate })
	{
	    next if ($priority_windows{$$b{PRIORITY}} += $$b{BYTES}) > $$self{WINDOW_SIZE};
	    &dbbindexec($u,
			":block" => $$b{BLOCK},
			":node" => $node,
			":now" => $now);
	    push(@activated_blocks, $b);
	}
	
	# Commit first phase so any concurrent modification of t_xfer_file
	# and t_xfer_replica is handled by our triggers.
	$dbh->commit();

	# Create file requests for the activated blocks.  The
	# expiration time is randomized to prevent massive loads of
	# work in one cycle later.
	my $i = &dbprep($dbh, qq{
	    insert into t_xfer_request
		(fileid, inblock, destination, priority, state,
		 attempt, time_create, time_expire, is_custodial)
		select
		id, :block inblock, :node destination, :priority priority,
		0 state, 1 attempt, :now, :now + dbms_random.value(7,10)*3600, bd.is_custodial
		from t_xfer_file, t_dps_block_dest bd
		where inblock = :block and inblock = bd.block and bd.destination = :node});
		    
	foreach my $b (@activated_blocks)
	{
	    &dbbindexec($i,
			":block" => $$b{BLOCK},
			":priority" => $$b{PRIORITY},
			":node" => $node,
			":now" => $now);
	}
	my $nblocks = scalar @activated_blocks;
	$self->Logmsg("activated $nblocks block destinations for node=$node") if $nblocks > 0;
	    
	# Now commit second phase.
	$dbh->commit();
    } else {
	# Lots of through traffic - don't allocate
	# Check how many blocks there are waiting
	my ($nblocks) = &dbexec($dbh, qq{
	    select count(*) from t_dps_block_dest where destination = :node and state = 0
	    }, ":node" => $node)->fetchrow();
	$self->Warn("through-traffic limit reached for node=$node.  no new block destinations activated out of $nblocks")
	    if $nblocks;
    }
    

    ######################################################################
    # Reactivate expired file requests.
    &dbexec($dbh, qq{
	update t_xfer_request
	set state = 0,
	    attempt = attempt+1,
	    time_expire = :now + dbms_random.value(7,10)*3600
	where destination = :me and state = 1 and :now >= time_expire},
	":me" => $node, ":now" => $now);
    $dbh->commit();
}

# Get a list of blocks destined for a node in order of request age
sub getDestinedBlocks_ByAge
{
    my ($dbh, $node) = @_;
    my $blocks = [];

    my $q = &dbexec($dbh, qq{
	select bd.dataset, bd.block, bd.priority, b.bytes
         from t_dps_block_dest bd
	 join t_dps_block b on b.id = bd.block
        where bd.destination = :node
          and bd.state = 0
          and exists (select 1 from t_dps_block_replica br
   		       where br.block = bd.block and br.is_active = 'y')
	  order by bd.time_create asc},
		    ":node" => $node);

    while (my $b = $q->fetchrow_hashref() ) {
	push @{$blocks}, $b;
    }
    
    return $blocks;
}



# Get a list of blocks destined for a node by load-balancing datasets.
# This attempts to allocate blocks from all requested datasets evenly 
sub getDestinedBlocks_DatasetBalance
{
    my ($dbh, $node) = @_;
    my $blocks = [];
    
    # Get current requests by dataset
    my $q_current = &dbexec($dbh, qq{
	select bd.dataset, sum(nvl(xf.filesize,0)) bytes
	  from t_dps_block_dest bd
	  left join t_xfer_request xq on xq.inblock = bd.block and xq.destination = bd.destination
	  left join t_xfer_file xf on xf.id = xq.fileid
	 where bd.state in (0, 1) and bd.destination = :node
         group by bd.dataset },
		    ':node' => $node);

    # Creates a hashref like $$allocation{ $dataset } = { BYTES => $bytes }
    my $allocation = $q_current->fetchall_hashref('DATASET');
    
    # Get destined blocks (with dataset information)
    my $q_destined = &dbexec($dbh, qq{
	select bd.dataset, bd.block, bd.priority, b.bytes
	  from t_dps_block_dest bd
	  join t_dps_block b on b.id = bd.block
         where bd.destination = :node
           and bd.state = 0
           and exists (select 1 from t_dps_block_replica br
		       where br.block = bd.block and br.is_active = 'y') },
			     ":node" => $node);

    # Creates a hashref like $$destined{ $dataset }{ $block } = { PRIORITY => $priority, BYTES => $bytes }
    my $destined = $q_destined->fetchall_hashref(['DATASET', 'BLOCK']);
   
    # Initialize unallocated datasets
    foreach my $dataset (keys %{$destined}) {
	$$allocation{$dataset}{BYTES} ||= 0;
    }

    # Build ordered list of blocks by load-balancing based on dataset bytes
  DATASET:  while ( scalar keys %{$destined} ) {
      my ($min_dataset, $next_smallest) = 
	  sort {$$allocation{$a}{BYTES} <=> $$allocation{$b}{BYTES}} keys %{$allocation};
      my $fill_to = $next_smallest ? $$allocation{$next_smallest}{BYTES} : 10**38;

      my @min_dataset_blocks = values %{ $$destined{$min_dataset} };
      while ( $$allocation{$min_dataset}{BYTES} <= $fill_to) {
	  if  ( ! @min_dataset_blocks ) {
	      # No more blocks - stop trying to fill it
	      delete $$allocation{$min_dataset};
	      delete $$destined{$min_dataset};
	      next DATASET;
	  }
	  my $b = shift @min_dataset_blocks;
	  push @{$blocks}, $b;
	  $$allocation{$min_dataset}{BYTES} += $$b{BYTES};
	  delete $$destined{$$b{DATASET}}{$$b{BLOCK}};
      }
  } 
    return $blocks;
}



sub routeFiles
{
    my ($self, $dbh, $links, @nodes) = @_;

    ######################################################################
    # Phase 2: Expand file requests into transfer paths through the
    # network.  For each request we build a minimum cost path from
    # available replicas using a routing table of network links and
    # current traffic conditions.  The transfer paths are refreshed
    # regularly to account for changes in network conditions.
    #
    # In other words, each destination node decides the entire path
    # for each file, using network configuration information it
    # obtains from other nodes.  For correctness it is important that
    # the entire route is built by one node using a consistent network
    # snapshot, building routes piecewise at each node using only
    # local information does not produce correct results.
    #
    # We begin with file replicas for each active file request and
    # current network conditions.  We calculate a least-cost transfer
    # path for each file.  We then update the database.

    # Read requests and replicas for requests without paths
    my $now = &mytimeofday();
    my $costs = {};
    my $ndone = 0;
    my $finished = 0;
    my $saved = undef;
    my $q = &dbexec($dbh, qq{
	select
	    xq.destination, xq.fileid, f.filesize,
	    xq.priority, xq.time_create, xq.time_expire,
	    xr.node, xr.state
	from t_xfer_request xq
	  join t_xfer_file f
	    on f.id = xq.fileid
	  join t_xfer_replica xr
	    on xr.fileid = xq.fileid
	where xq.state = 0
	  and xq.time_expire > :now
	  and not exists (select 1 from t_xfer_path xp
			  where xp.to_node = xq.destination
			    and xp.fileid = xq.fileid)
	order by destination, fileid},
	":now" => $now);
    while (! $finished)
    {
	$finished = 1;
	my %requests;
	my $nreqs = 0;
	my ($discarded, $existing) = (0, 0);
	my ($nhops, $nvalid) = (0, 0);
	my ($inserted, $updated) = (0, 0);
	while (my $row = $saved || $q->fetchrow_hashref())
	{
	    $saved = undef;
	    my $dest = $$row{DESTINATION};
	    next unless grep $dest == $_, @nodes;

	    my $file = $$row{FILEID};
	    my $size = $$row{FILESIZE};
	    my $sizebin = (int($size / (500*MEGABYTE))+1)*(500*MEGABYTE);

	    if (! exists $requests{$dest}{$file})
	    {
		if ($nreqs >= 50_000)
		{
		    $finished = 0;
		    $saved = $row;
		    last;
		}
		$nreqs++;
	    }

	    $requests{$dest}{$file} ||= { DESTINATION => $dest,
					  FILEID => $file,
					  FILESIZE => $size,
					  SIZEBIN => $sizebin,
					  PRIORITY => $$row{PRIORITY},
					  TIME_CREATE => $$row{TIME_CREATE},
					  TIME_EXPIRE => $$row{TIME_EXPIRE} };
	    $requests{$dest}{$file}{REPLICAS}{$$row{NODE}} = $$row{STATE};
	    $self->routeCost($links, $costs, $$row{NODE}, $$row{STATE}, $sizebin, 0);
	}

	# Build optimal file paths.
	my $probecosts = {};
	my @allreqs = map { values %$_ } values %requests;
	$self->routeFile($now, $links, $costs, $probecosts, $_) for @allreqs;

	# Build collection of all the hops.
	my %allhops;
	foreach my $req (@allreqs)
	{
	    foreach my $hop (@{$$req{PATH}})
	    {
		$allhops{$$hop{TO_NODE}}{$$req{FILEID}} ||= $hop;
	    }
	}

	# Compare with what is already in the database.  Keep new and better.
	my $qpath = &dbexec($dbh, qq{
	    select to_node, fileid, is_valid, is_local, total_cost
	    from t_xfer_path});
	while (my ($to, $file, $valid, $local, $cost) = $qpath->fetchrow())
	{
	    $existing++;

	    # If we are not considering replacement, skip this.
	    next if ! exists $allhops{$to}{$file};

	    # If the replacement is not better, skip this.
	    my $p = $allhops{$to}{$file};
	    if (! ($$p{IS_LOCAL} > $local
		   || ($$p{IS_LOCAL} = $local
		       && ($$p{IS_VALID} > $valid
			   || ($$p{IS_VALID} == $valid
			       && ($$p{TOTAL_LATENCY} || 0) < $cost)))))
	    {
		$$p{UPDATE} = 0;
		$discarded++;
		next;
	    }

	    # The replacement is better, replace this one.
	    $$p{UPDATE} = 1;
	}

	# Build arrays for database operation.
	my (%iargs, %uargs, %destnodes);
	foreach my $to (keys %allhops)
	{
	    foreach my $file (keys %{$allhops{$to}})
	    {
		my $hop = $allhops{$to}{$file};
		$nhops++;

		# Skip if we decided this wasn't worth looking at.
		next if exists $$hop{UPDATE} && ! $$hop{UPDATE};

		# Fill insert or update structure as appropriate.
		my $n = 1;
		my $args = $$hop{UPDATE} ? \%uargs : \%iargs;
		push(@{$$args{$n++}}, $$hop{DESTINATION});  # xp.destination
		push(@{$$args{$n++}}, $$hop{INDEX});  # xp.hop
		push(@{$$args{$n++}}, $$hop{SRC_NODE}); # xp.src_node
		push(@{$$args{$n++}}, $$hop{FROM_NODE}); # xp.from_node
		push(@{$$args{$n++}}, $$hop{PRIORITY}); # xp.priority
		push(@{$$args{$n++}}, $$hop{IS_LOCAL}); # xp.is_local
		push(@{$$args{$n++}}, $$hop{IS_VALID}); # xp.is_valid
		push(@{$$args{$n++}}, ($$hop{LINK_LATENCY} || 0) + ($$hop{XFER_LATENCY} || 0)); # xp.cost
		push(@{$$args{$n++}}, ($$hop{TOTAL_LATENCY} || 0)); # xp.total_cost
		push(@{$$args{$n++}}, ($$hop{LINK_RATE} || 0)); # xp.penalty
		push(@{$$args{$n++}}, $$hop{TIME_REQUEST}); # xp.time_request
		push(@{$$args{$n++}}, $now); # xp.time_confirm
		push(@{$$args{$n++}}, $$hop{TIME_EXPIRE}); # xp.time_expire
		push(@{$$args{$n++}}, $file); # xp.fileid
		push(@{$$args{$n++}}, $to); # xp.to_node
		$destnodes{$$hop{DESTINATION}} = 1;
		$nvalid++ if $$hop{IS_VALID};
	    }
	}

	# Insert and update paths as appropriate.
	&dbexec($dbh, qq{
	    insert into t_xfer_path
	    (destination, hop, src_node, from_node, priority, is_local,
	     is_valid, cost, total_cost, penalty, time_request,
	     time_confirm, time_expire, fileid, to_node)
	    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)},
	    %iargs) if %iargs;

	&dbexec($dbh, qq{
	    update t_xfer_path
	    set destination = ?, hop = ?, src_node = ?, from_node = ?,
		priority = ?, is_local = ?, is_valid = ?, cost = ?,
		total_cost = ?, penalty = ?, time_request = ?,
		time_confirm = ?, time_expire = ?
	    where fileid = ? and to_node = ?},
	    %uargs) if %uargs;

	$dbh->commit();

	# Report routing statistics.
	$inserted = %iargs ? scalar @{$iargs{1}} : 0;
	$updated = %uargs ? scalar @{$uargs{1}} : 0;
	$ndone += $inserted + $updated;

	my %node_names = reverse %{$$self{NODES_ID}};
	my $destnode_list = join ' ', sort @node_names{keys %destnodes};
	$self->Logmsg("routed files:  $existing existed, $updated updated, $inserted new,"
		. " $nvalid valid, $discarded discarded of $nhops paths"
		. " computed for $nreqs requests for the destinations"
		. " $destnode_list")
	    if $nreqs;

	# Now would be a great time to go for a long holiday :-)
	$self->maybeStop();
    }

    # Bring next slow synchornisation forward if we didn't route any
    # files and the file pump agent has given us a hint to restart
    # and next slow flush would be relatively far away.
    if (! $ndone)
    {
	my $markerval = (defined $$self{FLUSH_MARKER}
			 ? "currval" : "nextval");
	my ($marker) = &dbexec($dbh, qq{
	    select seq_xfer_done.$markerval from dual})
	    ->fetchrow();

	$$self{NEXT_SLOW_FLUSH} = $now
	    if ($marker > ($$self{FLUSH_MARKER} || -1)
		&& $$self{NEXT_SLOW_FLUSH} > $now + $$self{FLUSH_PERIOD}/4);

	$dbh->commit();
    }

    # Return how much we did.
    return $ndone;
}

# Calculate prototype file transfer cost.  The only factor affecting
# the cost of a file in the network is its source node and whether
# the file is staged in; the rest is determined by link parameters.
# So there is no reason to calculate the full minimum-spanning tree
# algorithm for every file -- we just calculate prototype costs for
# "staged file at node n", and propagate those costs to the entire
# network.  The actual file routing then just picks cheapest paths.
sub routeCost
{
    my ($self, $links, $costs, $node, $state, $sizebin, $probe) = @_;

    # If we already have a cost for this prototype, return immediately
    return if (exists $$costs{$node}
	       && exists $$costs{$node}{$state}
	       && exists $$costs{$node}{$state}{$sizebin});

    # Initialise the starting point: instant access for staged file,
    # 0h30 for not staged.  We optimise the transfer cost as the
    # estimated time of arrival, i.e. minimise transfer time,
    # accounting for the link latency (existing transfer queue).
    my %todo = ($node => 1);
    my $latency = $state ? 0 : 1800;
    my $paths = $$costs{$node}{$state}{$sizebin} = {};
    $$paths{$node} = {
	SRC_NODE => $node,
	FROM_NODE => $node,
	TO_NODE => $node,
	LINK_LATENCY => 0,
	LINK_RATE => undef,
	XFER_LATENCY => $latency,
	TOTAL_LINK_LATENCY => 0,
	TOTAL_XFER_LATENCY => $latency,
	TOTAL_LATENCY => $latency,
	IS_LOCAL => 1,
	HOPS => 0,
	REMOTE_HOPS => 0
    };

    # Now use Dijkstra's algorithm to compute minimum spanning tree.
    while (%todo)
    {
	foreach my $from (keys %todo)
	{
	    # Remove from list of nodes to do.
	    delete $todo{$from};

	    # Compute cost at each neighbour.
	    foreach my $to (keys %{$$links{$from}})
	    {
		# The rate estimate we use is the link nominal rate if
		# we have no performance data, where the nominal rate
		# is 0.5 MB/s divided by the database link distance.
		# If we have rate performance data and it shows the
		# link to be reasonably healthy, use that information.
		# If the link is unhealthy and we are probing after
		# failed routing, use the nominal rate.  Otherwise use
		# an "infinite" rate that will be cut-off by later
		# route validation.
		my $nominal = 0.5*MEGABYTE / $$links{$from}{$to}{HOPS};
		my $latency = ($probe ? 0 : ($$links{$from}{$to}{XFER_LATENCY} || 0));
		my $rate = ((! defined $$links{$from}{$to}{XFER_RATE}
			     || ($probe && $$links{$from}{$to}{XFER_RATE} < $nominal))
			    ? $nominal : $$links{$from}{$to}{XFER_RATE});
		my $xfer = ($rate ? $sizebin / $rate : 7*86400);
		my $total = $$paths{$from}{TOTAL_LATENCY} + $latency + $xfer;
		my $thislocal = 0;
		$thislocal = 1 if (exists $$links{$from}
				   && exists $$links{$from}{$to}
				   && $$links{$from}{$to}{IS_LOCAL});
		my $local = ($thislocal && $$paths{$from}{IS_LOCAL} ? 1 : 0);

		# If we would involve more than one WAN hop, incur penalty.
		# This value is larger than cut-off for valid paths later.
		if ($$paths{$from}{REMOTE_HOPS} && ! $thislocal)
		{
		    $xfer += 365*86400;
		    $total += 365*86400;
		}

		# Update the path if there is none yet, if we have local
		# path and existing is not local, or if we now have a
		# better cost without changing local attribute.
		if (! exists $$paths{$to}
		    || ($local && ! $$paths{$to}{IS_LOCAL})
		    || ($local == $$paths{$to}{IS_LOCAL}
			&& $total < $$paths{$to}{TOTAL_LATENCY}))
		{
		    # No existing path or it's more expensive.
		    $$paths{$to} = { SRC_NODE => $$paths{$from}{SRC_NODE},
				     FROM_NODE => $from,
				     TO_NODE => $to,
				     LINK_LATENCY => $latency,
				     LINK_RATE => $rate,
				     XFER_LATENCY => $xfer,
				     TOTAL_LINK_LATENCY => $$paths{$from}{TOTAL_LINK_LATENCY} + $latency,
				     TOTAL_XFER_LATENCY => $$paths{$from}{TOTAL_XFER_LATENCY} + $xfer,
				     TOTAL_LATENCY => $total,
				     IS_LOCAL => $local,
				     HOPS => $$paths{$from}{HOPS} + 1,
				     REMOTE_HOPS => $$paths{$from}{REMOTE_HOPS} + (1-$thislocal) };
		    $todo{$to} = 1;
		}
	    }
	}
    }
}

# Select best route for a file.
sub bestRoute
{
    my ($self, $costs, $request) = @_;
    my $dest = $$request{DESTINATION};

    # Use the precomupted replica path costs to pick the cheapest
    # available file we could transfer.  The costs are scaled by the
    # size of the file (it doesn't affect the result, but goes into
    # the tables on output).
    my $best = undef;
    my $bestcost = undef;
    my $sizebin = $$request{SIZEBIN};
    foreach my $node (keys %{$$request{REPLICAS}})
    {
	my $state = $$request{REPLICAS}{$node};
	next if (! exists $$costs{$node}
		 || ! exists $$costs{$node}{$state}
		 || ! exists $$costs{$node}{$state}{$sizebin}
		 || ! exists $$costs{$node}{$state}{$sizebin}{$dest});
	my $this = $$costs{$node}{$state}{$sizebin};

	next if ($$this{$dest}{REMOTE_HOPS} > 1); # Multi-WAN-hop paths are never the best.

	my $thiscost = $$this{$dest}{TOTAL_LATENCY};

	if (! defined $best
	    || $$this{$dest}{IS_LOCAL} > $$best{$dest}{IS_LOCAL}
	    || ($$this{$dest}{IS_LOCAL} == $$best{$dest}{IS_LOCAL}
		&& $thiscost <= $bestcost))
	{
	    $best = $this;
	    $bestcost = $thiscost;
	}
    }

    return ($best, $bestcost);
}

# Computes the optimal route for the file.
sub routeFile
{
    my ($self, $now, $links, $costs, $probecosts, $request) = @_;
    my $dest = $$request{DESTINATION};

    # Select best route.  If it's not a valid one, force re-routing
    # at a reasonably low (2%) probability to create routing probes.
    my ($best, $bestcost) = $self->bestRoute ($costs, $request);
    if (defined $best && $bestcost >= 3*86400 && rand() < 0.02)
    {
	$self->routeCost($links, $probecosts, $_, $$request{REPLICAS}{$_},
			 $$request{SIZEBIN}, 1)
	    for keys %{$$request{REPLICAS}};
	($best, $bestcost) = $self->bestRoute ($probecosts, $request);
	my $prettycost = int($bestcost);
	$self->Logmsg("probed file $$request{FILEID} to destination $dest: "
		. ($bestcost < 3*86400
		   ? "new cost $prettycost from $$best{$dest}{SRC_NODE}"
		   : "did not improve the matters, cost is $prettycost"));
    }

    # Now record path to the cheapest replica found, if we found one.
    delete $$request{PATH};
    if (defined $best)
    {
	my $index = 0;
	my $node = $dest;
	my $valid = $bestcost < 3*86400 ? 1 : 0;
	while ($$best{$node}{FROM_NODE} != $$best{$node}{TO_NODE})
	{
	    my $from = $$best{$node}{FROM_NODE};
	    my $item = { %{$$best{$node}} };
	    $$item{INDEX} = $index++;
	    $$item{IS_VALID} = $valid;
	    $$item{DESTINATION} = $$request{DESTINATION};
	    $$item{PRIORITY} = $$request{PRIORITY};
	    $$item{TIME_REQUEST} = $$request{TIME_CREATE};
	    $$item{TIME_EXPIRE} = ($valid ? $$request{TIME_EXPIRE}
				   : $now+(0.5+rand(4))*3600);
	    push(@{$$request{PATH}}, $item);
	    $node = $from;
	}

	$self->mark_route_success($dest, $$request{FILEID});
    }
    else
    {
	$self->mark_route_failure($dest, $$request{FILEID}, keys %{$$request{REPLICAS}} );
    }
}

# Update transfer request and path statistics.
sub stats
{
    my ($self, $dbh, $pathinfo) = @_;
    my $now = &mytimeofday();

    # Check if we need to update statistics.
    return if $now < $$self{NEXT_STATS};
    $$self{NEXT_STATS} = int($now/300) + 300;

    # Remove previous data and add new information.
    &dbexec($dbh, qq{delete from t_status_path});
    &dbexec($dbh, qq{
	insert into t_status_path
	(time_update, from_node, to_node, priority, is_valid, files, bytes)
	select :now, xp.from_node, xp.to_node, xp.priority, xp.is_valid,
	       count(xp.fileid), nvl(sum(f.filesize),0)
	from t_xfer_path xp join t_xfer_file f on f.id = xp.fileid
	group by :now, xp.from_node, xp.to_node, xp.priority, xp.is_valid},
	":now" => $now);

    &dbexec($dbh, qq{delete from t_status_request});
    &dbexec($dbh, qq{
	insert into t_status_request
	(time_update, destination, state, files, bytes, is_custodial, priority)
	select :now, xq.destination, xq.state,
	       count(xq.fileid), nvl(sum(f.filesize),0), xq.is_custodial,
		xq.priority
	from t_xfer_request xq join t_xfer_file f on f.id = xq.fileid
	group by :now, xq.destination, xq.state, xq.is_custodial, xq.priority},
	":now" => $now);

    &dbexec($dbh, qq{delete from t_status_block_path});
    &dbexec($dbh, qq{
	insert into t_status_block_path
	(time_update, destination, src_node, block, priority, is_valid,
	 route_files, route_bytes, xfer_attempts, time_request)
	select :now, xp.destination, xp.src_node, xf.inblock, xp.priority, xp.is_valid,
	count(xf.id), sum(xf.filesize), sum(xq.attempt), min(xq.time_create)
	from t_xfer_path xp
	join t_xfer_file xf on xf.id = xp.fileid
	join t_xfer_request xq on xq.fileid = xf.id and xq.destination = xp.destination
	group by xp.destination, xp.src_node, xf.inblock, xp.priority, xp.is_valid},
	    ":now" => $now);

    $dbh->commit();
    $self->Logmsg("updated statistics");
}

# Mark the failure of an unroutable file
sub mark_route_failure
{
    my ($self, $dest, $fileid, @sources) = @_;

    if (! $$self{ROUTE_FAILURES}{$dest}{$fileid} ) {
	$$self{NEW_ROUTE_FAILURE}{$dest} = 1;
    }

    my $reason = @sources ? 'no path to destination' : 'no source replicas';
    $$self{ROUTE_FAILURES}{$dest}{$reason}{$fileid} = [@sources];
}

# Delete an item from the cache of unroutable files
sub mark_route_success
{
    my ($self, $dest, $fileid) = @_;
    foreach my $reason (keys %{ $$self{ROUTE_FAILURES}{$dest} }) {
	delete $$self{ROUTE_FAILURES}{$dest}{$reason}{$fileid};
    }
}

# Warn about all failed routing attempts when there is a new failure
# TODO:  Print saved replica information on higher verbosity levels
sub warn_route_failures
{
    my ($self) = @_;
    
    foreach my $dest (sort keys %{$$self{NEW_ROUTE_FAILURE}}) {
	foreach my $reason (keys %{$$self{ROUTE_FAILURES}{$dest}}) {
	    $self->Warn("failed to route ",
		    scalar keys %{$$self{ROUTE_FAILURES}{$dest}{$reason}},
		    " files to node=$dest:  $reason");
	}
	delete $$self{NEW_ROUTE_FAILURE}{$dest};
    }
}

1;
