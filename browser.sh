#!/usr/bin/env sh
#
# Assign this script to the BROWSER env variable via:
#   export BROWSER=~/o2f/browser.sh
#
# This will ensure requests to open a browser get forwarded
# through to the proxy.
#
# Logs are written to OS-standard locations:
#   Linux: ~/.local/state/oauth2-forwarder/o2f-client.log
#   macOS: ~/Library/Logs/oauth2-forwarder/o2f-client.log
#   Windows: %LOCALAPPDATA%\oauth2-forwarder\logs\o2f-client.log
#

# fork and return 0 as some apps (e.g., az cli) expect a zero return
# before they will launch their redirect listener
node ~/o2f/o2f-client.js "$@" &

exit 0
