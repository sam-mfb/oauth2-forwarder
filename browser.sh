#!/usr/bin/env sh
#
# Assing this script to the BROWSER env variable via:
#   export BROWSER=~/oauth2-forwarder/browser.sh
#
# This will ensure requests to open a browser get forwarded
# through to the proxy
#
node ~/oauth2-forwarder/dist/o2f-client.js "$@"
