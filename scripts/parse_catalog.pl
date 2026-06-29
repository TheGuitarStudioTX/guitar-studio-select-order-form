#!/usr/bin/perl
# ============================================================
# parse_catalog.pl
# Parses order_form_v9.html (the legacy single-file order form)
# and emits db/03_seed_catalog.sql — suppliers, brands and ~2,200
# products — so the catalog never has to be re-keyed by hand.
#
# Usage:  perl scripts/parse_catalog.pl order_form_v9.html db/03_seed_catalog.sql
# ============================================================
use strict;
use warnings;
use utf8;

binmode(STDERR, ":encoding(UTF-8)");

my $in  = $ARGV[0] || 'order_form_v9.html';
my $out = $ARGV[1] || 'db/03_seed_catalog.sql';

open(my $fh, '<:encoding(UTF-8)', $in) or die "Cannot open $in: $!";
my @lines = <$fh>;
close($fh);

# ---- Reference data copied verbatim from the legacy form's JS -------------
# Each brand maps to the supplier (distributor / ordering contact) it ships from.
my %brand_supplier = (
  daddario=>'daddario', daddarioacc=>'daddario',
  savarez=>'savarez', knobloch=>'knobloch', labella=>'labella',
  hannabach=>'hannabach', guitarlift=>'guitarlift',
  khs=>'khs', nomad=>'khs',
  musicnomad=>'musicnomad', sagework=>'sagework', woodside=>'woodside',
  hlinstruction=>'halleonard', hlscores=>'halleonard',
  mbclassicalinstruction=>'melbay', mbclassicalscores=>'melbay',
  mbflamencoinstruction=>'melbay', mbflamenco=>'melbay',
);

# supplier slug => [name, contact, email, cc, address, terms]
my %suppliers = (
  savarez     => ['Savarez','Bernard Maillot','bmaillotp1@savarez.com','n.blazy@savarez.com','Savarez SA, Lyon, France','Contact for ordering terms. Previously ordered via Harris Teller distributor.'],
  knobloch    => ['Knobloch Strings','Daniel Baugh (Calido Guitars)','daniel@calidoguitars.com','laura@calidoguitars.com','Calido Guitars, (979) 236-0683','No formal minimum. Prefer 1 box (14 sets) per SKU for full sets. ACH, credit card, or PayPal. Overnight FedEx/UPS to Fort Worth.'],
  labella     => ['La Bella Strings','La Bella Strings','Info@labella.com','','La Bella Strings, +1 845 562-4400','No MOQs. Distributor pricing. Ship via UPS/FedEx (not included). ACH/Zelle or credit card (3.5% fee).'],
  daddario    => ["D'Addario","D'Addario",'','',"D'Addario & Company","Order via D'Addario dealer account."],
  woodside    => ['Woodside Guitar Supports','Eric Gruenberg','egruenberg@sc-america.com','yoyo@sc-america.com','SC America, LLC — ships from Guangzhou, China','Min. 6 units or equivalent. Payment before shipment via wire/TT or PayPal (buyer pays fees). Shipping approx. $160-280 depending on carton size.'],
  sagework    => ['Sagework Guitar Supports','Geoff Ferdon','sageworkgs@gmail.com','','Sagework Guitar Supports','No stated minimums. Confirm shipping and payment terms with Geoff before placing first order.'],
  musicnomad  => ['Music Nomad','Gerard Serafini','gerards@musicnomad.com','','Music Nomad','Opening order min: $200 (credit card). Reorders min: $100. Freight prepaid on orders $750+.'],
  khs         => ['KHS America (Hercules / NOMAD)','Trent Maize','Trent.Maize@khsmusic.com','chester.lin@khsmusic.com','KHS America, Inc., 12020 Etris Rd., Roswell, GA 30076','Active dealer account on file. Net 30 upon approved credit. Submit orders directly to Trent.'],
  hannabach   => ['Hannabach','Renee Ringholz (Howard Core Co.)','rringholz@howardcore.com','','Howard Core Company — US distributor for Hannabach','Dealer application on file. Contact Renee to confirm account activation and place first order.'],
  guitarlift  => ['GuitarLift','Maria Justen','info@guitarlift.de','','GuitarLift — Haferweg 10, 71706 Markgröningen, Germany','First order: payment in advance. Subsequent orders: net 30 days. Ships via DHL or FedEx from Germany at buyer\x27s cost. 40% off standard models; 25% off Young Students Line. Access dealer portal via Magic Link.'],
  halleonard  => ['Hal Leonard','Hal Leonard','sales@halleonard.com','','Hal Leonard LLC, 7777 W. Bluemound Rd., Milwaukee, WI 53213','Order through Hal Leonard dealer account. Include both Instructional and Musical Scores items in one order.'],
  melbay      => ['Mel Bay Publications','Mel Bay','','','Mel Bay Publications, Inc., Pacific, MO','Order through Mel Bay dealer account.'],
);

# brand slug => MOQ [amount, label]
my %moq = (
  savarez=>[0,'No minimum'], knobloch=>[0,'Prefer 14 sets/box per SKU'],
  labella=>[0,'No minimum'], hannabach=>[0,'Pending account activation'],
  daddario=>[0,'Pending dealer account'], daddarioacc=>[0,'Pending dealer account'],
  guitarlift=>[0,'No stated minimum · Advance payment 1st order'],
  khs=>[0,'Active account — confirm MOQ with Trent'],
  musicnomad=>[200,'$200 opening · $100 reorder'], nomad=>[0,'Same account as KHS'],
  sagework=>[0,'No stated minimum'], woodside=>[0,'6 units minimum'],
  mbclassicalinstruction=>[0,'No minimum'], mbclassicalscores=>[0,'No minimum'],
  mbflamencoinstruction=>[0,'No minimum'], mbflamenco=>[0,'No minimum'],
  hlinstruction=>[0,'Confirm minimum with HL rep'], hlscores=>[0,'Confirm minimum with HL rep'],
);

# finer data-category (subcategory) => top-level category required by spec
my %cat_map = (
  strings=>'strings',
  accessories=>'accessories', care=>'accessories', supports=>'accessories', stands=>'accessories',
  instructional=>'literature', scores=>'literature',
);

# ---- Helpers --------------------------------------------------------------
sub decode_entities {
  my $s = shift;
  $s =~ s/&#(\d+);/chr($1)/ge;
  $s =~ s/&lt;/</g; $s =~ s/&gt;/>/g; $s =~ s/&quot;/"/g;
  $s =~ s/&#39;/'/g; $s =~ s/&apos;/'/g; $s =~ s/&nbsp;/ /g;
  $s =~ s/&amp;/&/g;   # must be last
  return $s;
}
sub clean {
  my $s = shift; return undef unless defined $s;
  $s = decode_entities($s);
  $s =~ s/^\s+//; $s =~ s/\s+$//;
  return $s;
}
sub q_sql { my $s = shift; return 'NULL' unless defined $s && $s ne ''; $s =~ s/'/''/g; return "'$s'"; }
sub price { my $s = shift; return 'NULL' unless defined $s; $s =~ s/[^0-9.]//g; return ($s eq '') ? 'NULL' : $s; }

# Derive a tension label from a description, mirroring the legacy text filters.
sub tension_of {
  my $d = shift; my $t = lc $d;
  if ($d =~ /([A-Za-z][A-Za-z\/ ]*?)\s+Tension/) {
    my $val = lc $1; $val =~ s/^\s+//; $val =~ s/\s+$//;
    # collapse to the last 1-2 descriptive words (e.g. "Coated Classical Strings — Normal" -> "normal")
    my @w = split /\s+/, $val;
    $val = (@w > 2) ? join(' ', @w[-2..-1]) : $val;
    $val =~ s/^[—-]\s*//;
    return $val;
  }
  return undef;
}

# ---- Parse ----------------------------------------------------------------
my (@brand_order, %brands, %prod_by_brand);
my ($cur, $group, $subgroup, $sort);

for my $line (@lines) {
  if ($line =~ /<div class="brand-section[^"]*"\s+id="brand-([a-z0-9]+)"\s+data-category="([a-z]+)"/i) {
    $cur = $1;
    my $subcat = $2;
    push @brand_order, $cur unless $brands{$cur};
    $brands{$cur} = {
      slug => $cur, subcat => $subcat,
      category => ($cat_map{$subcat} || $subcat),
      supplier => ($brand_supplier{$cur} || $cur),
      name => $cur, brand_type => undef,
      moq_amount => ($moq{$cur} ? $moq{$cur}[0] : 0),
      moq_label  => ($moq{$cur} ? $moq{$cur}[1] : undef),
    };
    $group = undef; $subgroup = undef; $sort = 0;
    next;
  }
  next unless $cur;

  if ($line =~ /<h2>(.*?)<\/h2>/i)                          { $brands{$cur}{name} = clean($1); next; }
  if ($line =~ /<span class="brand-type">(.*?)<\/span>/i)   { $brands{$cur}{brand_type} = clean($1); next; }

  if ($line =~ /<tr class="cat-row"[^>]*><td[^>]*>(.*?)<\/td>/i)      { $group = clean($1); $subgroup = undef; next; }
  if ($line =~ /<tr class="cat-row-inner"[^>]*><td[^>]*>(.*?)<\/td>/i){ $group = clean($1); $subgroup = undef; next; }
  if ($line =~ /<tr class="sub-cat-row"[^>]*><td[^>]*>(.*?)<\/td>/i)  { $subgroup = clean($1); next; }

  # Product row: any <tr ...> that carries a <td class="sku">
  if ($line =~ /<tr\b([^>]*)>.*?<td class="sku">(.*?)<\/td>/i) {
    my ($attrs, $sku) = ($1, $2);
    my $pack;
    $pack = $1 if $attrs =~ /data-pack="([a-z]+)"/i;
    my ($desc)   = $line =~ /<td class="desc">(.*?)<\/td>/i;
    my ($retail) = $line =~ /<td class="num">(.*?)<\/td>/i;
    my ($dealer) = $line =~ /<td class="dealer-cost">(.*?)<\/td>/i;
    $sku = clean($sku); $desc = clean($desc);
    next unless defined $sku && $sku ne '';
    $sort++;
    push @{ $prod_by_brand{$cur} }, {
      sku=>$sku, desc=>$desc, retail=>$retail, dealer=>$dealer,
      pack=>$pack, tension=>tension_of($desc // ''),
      group=>$group, subgroup=>$subgroup, sort=>$sort,
    };
  }
}

# ---- Emit SQL -------------------------------------------------------------
open(my $o, '>:encoding(UTF-8)', $out) or die "Cannot write $out: $!";
print $o "-- ============================================================\n";
print $o "-- Guitar Studio Select — Catalog seed\n";
print $o "-- AUTO-GENERATED from order_form_v9.html by scripts/parse_catalog.pl\n";
print $o "-- Run AFTER gcs_supabase_schema.sql and db/02_catalog_schema.sql\n";
print $o "-- Idempotent: re-running upserts by natural key (slug / brand+sku).\n";
print $o "-- ============================================================\n\n";

# Suppliers
print $o "-- ---- Suppliers --------------------------------------------------\n";
print $o "insert into public.suppliers (slug, name, contact, email, cc, address, terms) values\n";
my @srows;
for my $sl (sort keys %suppliers) {
  my ($n,$c,$e,$cc,$a,$t) = @{$suppliers{$sl}};
  push @srows, "  (".q_sql($sl).", ".q_sql($n).", ".q_sql($c).", ".q_sql($e).", ".q_sql($cc).", ".q_sql($a).", ".q_sql($t).")";
}
print $o join(",\n", @srows), "\n";
print $o "on conflict (slug) do update set\n";
print $o "  name=excluded.name, contact=excluded.contact, email=excluded.email,\n";
print $o "  cc=excluded.cc, address=excluded.address, terms=excluded.terms;\n\n";

# Brands
print $o "-- ---- Brands -----------------------------------------------------\n";
print $o "insert into public.brands (slug, name, brand_type, category, subcategory, supplier_id, moq_amount, moq_label, sort_order) values\n";
my @brows; my $bsort = 0;
for my $b (@brand_order) {
  $bsort++;
  my $d = $brands{$b};
  my $sup = "(select id from public.suppliers where slug=".q_sql($d->{supplier}).")";
  push @brows, "  (".q_sql($d->{slug}).", ".q_sql($d->{name}).", ".q_sql($d->{brand_type}).", "
    .q_sql($d->{category}).", ".q_sql($d->{subcat}).", $sup, "
    .($d->{moq_amount}+0).", ".q_sql($d->{moq_label}).", $bsort)";
}
print $o join(",\n", @brows), "\n";
print $o "on conflict (slug) do update set\n";
print $o "  name=excluded.name, brand_type=excluded.brand_type, category=excluded.category,\n";
print $o "  subcategory=excluded.subcategory, supplier_id=excluded.supplier_id,\n";
print $o "  moq_amount=excluded.moq_amount, moq_label=excluded.moq_label, sort_order=excluded.sort_order;\n\n";

# Products — batched inserts (1000-row chunks keep statements manageable)
print $o "-- ---- Products ---------------------------------------------------\n";
my $total = 0; my %seen; my $dupes = 0;
my @all;
for my $b (@brand_order) {
  for my $p (@{ $prod_by_brand{$b} || [] }) {
    my $key = "$b|$p->{sku}";
    if ($seen{$key}++) { $dupes++; next; }   # keep first occurrence; brand+sku is the upsert key
    my $brid = "(select id from public.brands where slug=".q_sql($b).")";
    push @all, "  ($brid, ".q_sql($p->{sku}).", ".q_sql($p->{desc}).", "
      .price($p->{retail}).", ".price($p->{dealer}).", ".q_sql($p->{pack}).", "
      .q_sql($p->{tension}).", ".q_sql($p->{group}).", ".q_sql($p->{subgroup}).", ".$p->{sort}.")";
    $total++;
  }
}
my $cols = "(brand_id, sku, description, retail, dealer_cost, pack_type, tension, group_label, subgroup_label, sort_order)";
my $upsert = "on conflict (brand_id, sku) do update set\n"
  ."  description=excluded.description, retail=excluded.retail, dealer_cost=excluded.dealer_cost,\n"
  ."  pack_type=excluded.pack_type, tension=excluded.tension, group_label=excluded.group_label,\n"
  ."  subgroup_label=excluded.subgroup_label, sort_order=excluded.sort_order, active=true;\n";
my $chunk = 500;
for (my $i = 0; $i < @all; $i += $chunk) {
  my $end = ($i + $chunk - 1 < $#all) ? $i + $chunk - 1 : $#all;
  print $o "insert into public.products $cols values\n";
  print $o join(",\n", @all[$i..$end]), "\n";
  print $o $upsert, "\n";
}
close($o);

# ---- Report ---------------------------------------------------------------
printf STDERR "Brands:    %d\n", scalar(@brand_order);
printf STDERR "Suppliers: %d\n", scalar(keys %suppliers);
printf STDERR "Products:  %d  (skipped %d duplicate brand+sku)\n", $total, $dupes;
printf STDERR "Output:    %s\n", $out;
for my $b (@brand_order) {
  printf STDERR "  %-26s %-11s %4d items\n", $b, $brands{$b}{category}, scalar(@{$prod_by_brand{$b}||[]});
}
