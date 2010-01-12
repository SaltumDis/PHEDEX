package PHEDEX::Web::Core;

=pod
=head1 NAME

PHEDEX::Web::Core - fetch, format, and return PhEDEx data

=head1 DESCRIPTION

This is the core module of the PhEDEx Data Service, a framework to
serve PhEDEx data in multiple formats for machine consumption.

=head2 URL Format

Calls to the PhEDEx data service should be made using the following URL format:

C<http://host.cern.ch/phedex/datasvc/FORMAT/INSTANCE/CALL?OPTIONS>

 FORMAT    the desired output format (e.g. xml, json, or perl)
 INSTANCE  the PhEDEx database instance from which to fetch the data
           (e.g. prod, debug, dev)
 CALL      the API call to make (see below)
 OPTIONS   the options to the CALL, in standard query string format

=head2 Output

Each response will have the following data in its "top level"
attributes.  With the XML format, these attributes appear in the
top-level "phedex" element.

 request_timestamp  unix timestamp, time of request
 request_date       human-readable time of request
 request_call       name of API call
 instance           PhEDEx DB instance
 call_time          time it took to serve call
 request_url        the full URL of the request

=head2 Errors

When possible, errors are returned in the format requested by the
user.  However, if the user's format could not be determined by the
datasvc, the error will be returned as XML.

Errors contain one element, <error>, which contains a text message of
the problem.

C<http://host.cern.ch/phedex/datasvc/xml/prod/foobar>

   <error>
   API call 'foobar' is not defined.  Check the URL
   </error>

=head2 Multi-Value filters

Filters with multiple values follow some common rules for all calls,
unless otherwise specified:

 * by default the multiple-value filters form an "or" statement
 * by specifying another option, 'op=name:and', the filters will form an "and" statement
 * filter values beginning with '!' look for negated matches
 * filter values may contain the wildcard character '*'
 * filter values with the value 'NULL' will match NULL (undefined) results

examples:

 ...?node=A&node=B&node=C
    node matches A, B, or C; but not D, E, or F
 ...?node=foo*&op=node:and&node=!foobar
    node matches 'foobaz', 'foochump', but not 'foobar'

=cut

use warnings;
use strict;

use base 'PHEDEX::Core::DB';
use PHEDEX::Core::Loader;
use PHEDEX::Core::Timing;
use CMSWebTools::SecurityModule::Oracle;
use PHEDEX::Web::Util;
use PHEDEX::Web::Cache;
use PHEDEX::Web::Format;
use HTML::Entities; # for encoding XML

our (%params);
%params = ( CALL => undef,
            VERSION => undef,
            DBCONFIG => undef,
	    INSTANCE => undef,
	    REQUEST_URL => undef,
            REMOTE_HOST => undef,
            USER_AGENT => undef,
	    REQUEST_TIME => undef,
            REQUEST_METHOD => undef,
	    SECMOD => undef,
	    DEBUG => 0,
	    CONFIG_FILE => undef,
            CONFIG => undef,
	    CACHE_CONFIG => undef,
	    SECMOD_CONFIG => undef,
	    AUTHZ => undef
	    );

# A map of API calls to data sources
our $call_data = { };

# Data source parameters
our $data_sources = { };

sub new
{
    my $proto = shift;
    my $class = ref($proto) || $proto;
    my $self  = ref($proto) ? $class->SUPER::new(@_) : {};
    
    my %args = (@_);
    map {
        $self->{$_} = defined($args{$_}) ? $args{$_} : $params{$_}
    } keys %params; 

    $self->{REQUEST_TIME} ||= &mytimeofday();

    bless $self, $class;

    # Set up database connection
    my $t1 = &mytimeofday();
    $self->connectToDatabase(0);
    my $t2 = &mytimeofday();
    warn "db connection time ", sprintf('%.6f s', $t2-$t1), "\n" if $self->{DEBUG};

    # Load the API component
    my $loader = PHEDEX::Core::Loader->new( NAMESPACE => 'PHEDEX::Web::API' );
    my $module = $loader->Load($self->{CALL});
    $self->{API} = $module;

    $self->{CACHE} = PHEDEX::Web::Cache->new( %{$self->{CACHE_CONFIG}} );

    return $self;
}

sub AUTOLOAD
{
    my $self = shift;
    my $attr = our $AUTOLOAD;
    $attr =~ s/.*:://;
    if ( exists($params{$attr}) )
    {
	$self->{$attr} = shift if @_;
	return $self->{$attr};
    }
    my $parent = "SUPER::" . $attr;
    $self->$parent(@_);
}

sub DESTROY
{
}

# prepare_call() -- before calling the API
#
# This is called before the header was sent out (in DataService.pm)
# Therefore, any cookies generated here could be attached to the header
#
# The primary purpose was for password authentication, yet it could
# be generalized for other pre-call checks.
#
sub prepare_call
{
    my ($self, $format, %args) = @_;
    my $api = $self->{API};

    eval {
        # check allowed methods
        if ($api->can('methods_allowed'))
        {
            my $methods_allowed = $api->methods_allowed();
            if (ref($methods_allowed) eq 'ARRAY')
            {
                if (not grep {$_ eq $self->{REQUEST_METHOD}} @{$methods_allowed})
                {
                    &PHEDEX::Web::Format::error(*STDOUT, 'xml', "method ". $self->{REQUEST_METHOD} . " is prohibited");
                    return;
                }
            }
            elsif ($self->{REQUEST_METHOD} ne $methods_allowed)
            {
                &PHEDEX::Web::Format::error(*STDOUT, 'xml', "method ". $self->{REQUEST_METHOD} . " is prohibited");
                return;
            }
        }
    
        # determine whether we need authorization
        my $need_auth = $api->need_auth() if $api->can('need_auth');
        if ($need_auth) {
            $self->initSecurity();
        }
    };

    # pass along the error message, if any.
    return $@;
}

sub call
{
    my ($self, $format, %args) = @_;
    no strict 'refs';

    # check the format argument then remove it
    if (!grep $_ eq $format, qw( xml json perl )) {
        &PHEDEX::Web::Format::error(*STDOUT, 'xml', "Return format requested is unknown or undefined");
	return;
    }

    my ($t1,$t2);

    $t1 = &mytimeofday();
    &process_args(\%args);

    my $obj = $self->getData($self->{CALL}, %args);
    my $stdout = '';
    if ( ! $obj )
    {
      my $api = $self->{API};
      eval {

        if ($api->can('spool'))
        {
            my $fmt;
            # open (local *STDOUT,'>/dev/null');
            my $spool = $api . '::spool';
            $fmt = PHEDEX::Web::Format->new($format, *STDOUT);
            die "unknown format $format" if (not $fmt);

            #create header
            
            my $phedex = {};
            $phedex->{instance} = $self->{INSTANCE};
            $phedex->{request_version} = $self->{VERSION};
            $phedex->{request_url} = $self->{REQUEST_URL};
            $phedex->{request_call} = $self->{CALL};
            $phedex->{request_timestamp} = $self->{REQUEST_TIME};
            $phedex->{request_date} = &formatTime($self->{REQUEST_TIME}, 'stamp');
            $phedex = { phedex => $phedex };
            $fmt->header($phedex);

            $obj = $spool->($self, %args);
            do
            {
                $fmt->output($obj);
            } while (($obj = $spool->($self, %args))
                     && $fmt->separator());
            $t2 = &mytimeofday();
            $fmt->footer($phedex, $t2-$t1);
        }
        elsif ($api->can('invoke'))
        {
            #open (local *STDOUT,'>',\$stdout);
            my $invoke = $api . '::invoke';
	    # make the call
            $obj = $invoke->($self, %args);
            $t2 = &mytimeofday();
            my $duration = $self->getCacheDuration() || 0;
            $self->{CACHE}->set( $self->{CALL}, \%args, $obj, $duration ); # unless $args{nocache};
    # wrap the object in a 'phedex' element with useful metadata
            $obj->{stdout}->{'$t'} = $stdout if $stdout;
            $obj->{instance} = $self->{INSTANCE};
            $obj->{request_version} = $self->{VERSION};
            $obj->{request_url} = $self->{REQUEST_URL};
            $obj->{request_call} = $self->{CALL};
            $obj->{request_timestamp} = $self->{REQUEST_TIME};
            $obj->{request_date} = &formatTime($self->{REQUEST_TIME}, 'stamp');
            $obj->{call_time} = sprintf('%.5f', $t2 - $t1);
            $obj = { phedex => $obj };
            $t1 = &mytimeofday();
            &PHEDEX::Web::Format::output(*STDOUT, $format, $obj);
            $t2 = &mytimeofday();
            warn "api call '$self->{CALL}' delivered in ", sprintf('%.6f s', $t2-$t1), "\n" if $self->{DEBUG};
        }
        else
        {
            die "API error: can not be called";
        }
        warn "api call '$self->{CALL}' complete in ", sprintf('%.6f s',$t2-$t1), "\n" if $self->{DEBUG};
      };
      if ($@) {
          &PHEDEX::Web::Format::error(*STDOUT, $format, "Error when making call '$self->{CALL}':  $@");
	  return;
      }
    }
}

# Cache controls
sub getData
{
    my ($self, $name, %h) = @_;
    my ($t1,$t2,$data);

    return undef unless exists $data_sources->{$name};

    $t1 = &mytimeofday();
    $data = $self->{CACHE}->get( $name, \%h );
    return undef unless $data;
    $t2 = &mytimeofday();
    warn "got '$name' from cache in ", sprintf('%.6f s', $t2-$t1), "\n" if $self->{DEBUG};

    return $data;
}



# Returns the cache duration for a API call.
sub getCacheDuration
{
    my ($self) = @_;
    my $duration = 0;
    my $api = $self->{API};
    $duration = $api->duration() if $api->can('duration');
    return $duration;
}

sub initSecurity
{
  my $self = shift;

  my %args;
  if ($self->{SECMOD_CONFIG}) {
      # If a config file is given, we use that
      $args{CONFIG} = $self->{SECMOD_CONFIG};
  } else {
      # Otherwise we check for a "SecurityModule" section in DBParam, and use the defaults
      my $config = $self->{CONFIG};
      my $dbparam = { DBCONFIG => $config->{DBPARAM},
		      DBSECTION => 'SecurityModule' };
      bless $dbparam;
      eval {
	  &parseDatabaseInfo($dbparam);
      };
      if ($@ || !$dbparam) {
	  die "no way to initialize SecurityModule:  either configure secmod-config ",
	  "or provide SecurityModule section in the DBParam file",
	  ($@ ? ": parse error: $@" : ""), "\n";
      }
      $args{DBNAME} = $dbparam->{DBH_DBNAME};
      $args{DBUSER} = $dbparam->{DBH_DBUSER};
      $args{DBPASS} = $dbparam->{DBH_DBPASS};
      $args{LOGLEVEL} = ($config->{SECMOD_LOGLEVEL} || 3);
      $args{REVPROXY} = $config->{SECMOD_REVPROXY} if $config->{SECMOD_REVPROXY};
      # practically, no self sign-up
      $args{SIGNUP_HANDLER} = sub {
          die "authentication check failed:  user not registered in SiteDB\n"
          };
      # disable the password form, too
      $args{PWDFORM_HANDLER} = sub {
          die "authentication check failed:  user not registered in SiteDB\n"
          };
  }
  my $secmod = new CMSWebTools::SecurityModule::Oracle({%args});
  if ( ! $secmod->init() )
  {
      die("cannot initialise security module: " . $secmod->getErrMsg());
  }
  $self->{SECMOD} = $secmod;

  return 1;
}


sub checkAuth
{
  my ($self,%args) = @_;
  die "bad call to checkAuth\n" unless $self->{SECMOD};
  my $secmod = $self->{SECMOD};
  $secmod->reqAuthnCert();
  return $self->getAuth(%args);
}

sub getAuth
{
    my ($self, $ability) = @_;
    my ($secmod,$auth);

    $secmod = $self->{SECMOD};
    $auth = {
	STATE  => $secmod->getAuthnState(),
	ROLES  => $secmod->getRoles(),
	DN     => $secmod->getDN(),
    };
    $auth->{NODES} = $self->auth_nodes($self->{AUTHZ}, $ability, with_ids => 1);

    return $auth;
}

1;
