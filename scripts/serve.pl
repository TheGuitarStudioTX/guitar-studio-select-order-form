#!/usr/bin/perl
# Minimal static file server for local development of the public/ site.
# Usage: perl scripts/serve.pl [port]   (default 8787)
use strict; use warnings;
use IO::Socket::INET;

my $port = $ARGV[0] || 8787;
my $root = "public";
my %MIME = (
  html=>'text/html; charset=utf-8', js=>'text/javascript; charset=utf-8',
  mjs=>'text/javascript; charset=utf-8', css=>'text/css; charset=utf-8',
  json=>'application/json', svg=>'image/svg+xml', png=>'image/png',
  jpg=>'image/jpeg', ico=>'image/x-icon', map=>'application/json',
);
$| = 1;
my $srv = IO::Socket::INET->new(LocalAddr=>'127.0.0.1', LocalPort=>$port,
  Proto=>'tcp', Listen=>20, ReuseAddr=>1) or die "Cannot bind $port: $!";
print "Serving ./$root on http://127.0.0.1:$port\n";

while (my $c = $srv->accept) {
  my $req = <$c>;
  if (defined $req && $req =~ m{^GET\s+(\S+)\s}) {
    my $path = $1; $path =~ s/\?.*//; $path = '/index.html' if $path eq '/';
    $path =~ s{\.\.}{}g;
    my $file = "$root$path";
    if (-d $file) { $file .= '/index.html'; $path .= '/index.html'; }
    # SPA fallback
    $file = "$root/index.html" unless -f $file;
    open(my $f, '<:raw', $file) or do { print $c "HTTP/1.0 404 Not Found\r\n\r\nNot found"; close $c; next; };
    local $/; my $body = <$f>; close $f;
    my ($ext) = $file =~ /\.([a-z0-9]+)$/i; $ext = lc($ext // 'html');
    my $type = $MIME{$ext} || 'application/octet-stream';
    print $c "HTTP/1.0 200 OK\r\nContent-Type: $type\r\nContent-Length: ".length($body)."\r\nCache-Control: no-cache\r\n\r\n";
    print $c $body;
  } else {
    print $c "HTTP/1.0 400 Bad Request\r\n\r\n";
  }
  close $c;
}
