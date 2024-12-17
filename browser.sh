#!/usr/bin/env sh
#
# Assing this script to the BROWSER env variable via:
#   export BROWSER=~/o2f/browser.sh
#
# This will ensure requests to open a browser get forwarded
# through to the proxy
#
LOG_FILE="/tmp/oauth2-forwarder.log"

# fork and return 0 as some apps (e.g., az cli) expect a zero return 
# before they will launch their redirect listener
node ~/o2f/o2f-client.js "$@" >> "$LOG_FILE" 2>&1 &

exit 0
