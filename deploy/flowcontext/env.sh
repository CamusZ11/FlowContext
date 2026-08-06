#!/bin/sh

# Reads the operator environment as data. Do not source .env: its contents are
# untrusted input even though its mode is checked by the caller.
load_flowcontext_env() {
  [ "$#" -eq 1 ] && [ -r "$1" ] || return 1

  POSTGRES_PASSWORD=
  FLOWCONTEXT_OWNER_ID=
  FLOWCONTEXT_PUBLIC_URL=
  ACME_EMAIL=
  seen_postgres=0
  seen_owner=0
  seen_public=0
  seen_acme=0

  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || return 1
    if printf '%s' "$line" | LC_ALL=C grep -q '[[:cntrl:]]'; then return 1; fi
    case "$line" in *'$('*) return 1 ;; esac
    if printf '%s' "$line" | grep -F '`' >/dev/null 2>&1; then return 1; fi
    case "$line" in *=*) ;; *) return 1 ;; esac
    key=${line%%=*}
    value=${line#*=}
    case "$key" in
      POSTGRES_PASSWORD) [ "$seen_postgres" -eq 0 ] || return 1; POSTGRES_PASSWORD=$value; seen_postgres=1 ;;
      FLOWCONTEXT_OWNER_ID) [ "$seen_owner" -eq 0 ] || return 1; FLOWCONTEXT_OWNER_ID=$value; seen_owner=1 ;;
      FLOWCONTEXT_PUBLIC_URL) [ "$seen_public" -eq 0 ] || return 1; FLOWCONTEXT_PUBLIC_URL=$value; seen_public=1 ;;
      ACME_EMAIL) [ "$seen_acme" -eq 0 ] || return 1; ACME_EMAIL=$value; seen_acme=1 ;;
      *) return 1 ;;
    esac
  done < "$1"

  [ "$seen_postgres" -eq 1 ] && [ "$seen_owner" -eq 1 ] && [ "$seen_public" -eq 1 ] && [ "$seen_acme" -eq 1 ] || return 1
  export POSTGRES_PASSWORD FLOWCONTEXT_OWNER_ID FLOWCONTEXT_PUBLIC_URL ACME_EMAIL
}
