#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
site_name=flowcontext.zkabi.cn
available=/etc/nginx/sites-available/$site_name
enabled=/etc/nginx/sites-enabled/$site_name
cert_include=/etc/nginx/snippets/$site_name-certbot.conf

fail() {
  printf '%s\n' "Nginx site install failed: $1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "run as root only for this narrowly scoped Nginx site operation"
[ "$#" -eq 1 ] || fail "usage: $0 --http-only|--enable-tls"
case "$1" in
  --http-only) source=$root_dir/nginx/$site_name.http.conf ;;
  --enable-tls)
    source=$root_dir/nginx/$site_name.conf
    [ -f "$cert_include" ] || fail "missing Certbot include: $cert_include"
    ;;
  *) fail "usage: $0 --http-only|--enable-tls" ;;
esac
[ -f "$source" ] || fail "source template is missing"
[ ! -e "$available" ] || fail "refusing to replace an existing Nginx site: $available"
[ ! -e "$enabled" ] || fail "refusing to replace an existing Nginx site link: $enabled"

install -m 0644 "$source" "$available"
ln -s "$available" "$enabled"
if ! nginx -t; then
  rm -f "$enabled" "$available"
  fail "Nginx validation failed; only the new site files were removed"
fi
nginx -s reload
printf '%s\n' "installed isolated Nginx site: $site_name"
