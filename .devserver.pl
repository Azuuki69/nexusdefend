use strict; use warnings; use IO::Socket::INET;
my $port = shift || 8777;
my $srv = IO::Socket::INET->new(LocalAddr=>'127.0.0.1', LocalPort=>$port, Listen=>32, Reuse=>1, Proto=>'tcp') or die "bind: $!";
my %ct=(html=>'text/html',png=>'image/png',jpg=>'image/jpeg',mp3=>'audio/mpeg',js=>'application/javascript',css=>'text/css');
print "serving $port\n";
while (my $c = $srv->accept) {
  my $req = <$c>; if(!defined $req){close $c; next;}
  while (my $h = <$c>) { last if $h =~ /^\r?\n$/; }
  my ($path) = $req =~ m{^GET\s+(\S+)}; $path='/' unless defined $path;
  $path =~ s/\?.*$//; $path='/index.html' if $path eq '/'; $path =~ s{\.\./}{}g;
  $path =~ s/%20/ /g;
  my $file='.'.$path;
  if (-f $file) { my ($e)=$file=~/\.([A-Za-z0-9]+)$/; my $t=$ct{lc($e||'')}||'application/octet-stream';
    open my $f,'<:raw',$file; local $/; my $b=<$f>; close $f;
    print $c "HTTP/1.1 200 OK\r\nContent-Type: $t\r\nContent-Length: ".length($b)."\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"; print $c $b;
  } else { print $c "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"; }
  close $c;
}
