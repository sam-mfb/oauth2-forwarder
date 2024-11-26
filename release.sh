#!/bin/sh

cd dist
mkdir -p o2f
cp ../browser.sh o2f
cp o2f-client.js o2f
cp o2f-server.js o2f
zip oauth2-forwarder.zip -rm o2f
