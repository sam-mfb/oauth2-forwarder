# oauth2-forwarder

This utility allows forwarding an oauth2 interactive request that is initiated inside a docker container to the browser on the docker host and then forwarding the resulting redirect back into the docker container. The net effect is that a command line tool inside the docker container can perform interactive oauth2 authentication using the browser flow on its host.

## Background

Imagine you have a command line tool that performs oauth2 interactive login. The typical flow of that application is this:

1. CLI tool sends an interactive login url to the browser and, simultaneously, opens up an http service to listen for the redirect response.
2. The browser opens the login url and the user performs interactive authentication.
3. The successful interactive authentication results in a redirect GET request being made with the new authentication code.
4. The http service setup by the CLI tool receives the redirect requests, extracts the code, and uses it.

This, for example, is exactly how the @azure/msal-node library works if you use the `.acquireTokenInteractive()` method on a public application.

This flow breaks down if you try to use it inside a docker container (at least one without a GUI) because step 2 fails, i.e., there is no way for the CLI to launch the host's browser for interactive login. You could get around this by using a device flow, but (a) that's a little more cumbersome, and (b) often conditional access policies will block that flow if they are checking for device compliance.

If you ever tried to do this from inside a docker container managed by VS Code, you'd have seen that it magically works. This utility gives you similar functionality without needing to use VS Code.

This utility works by changing the flow above as follows using a client-server pair provided by the utility--called, respectively, `o2f-server` and `o2f-client`--to proxy sending the request and redirect urls back and forth between the container and host. The flow then becomes:

1. [container] CLI tool sends an interactive login url to the browser and, simultaneously, opens up an http service to listen for the redirect response.
2. [container] `o2f-client` intercepts the request and forwards the url to `o2f-server` over a custom tcp port
3. [host] `o2f-server` receives the request sends the the login url to the browser and simultaneously opens an http service to listen for the redirect response
4. [host] The browser opens the login url and the user performs interactive authentication.
5. [host] The successful interactive authentication results in a redirect GET request being made with the new authentication code.
6. [host] The http service setup by `o2f-server` receives the redirect requests, extracts the code, and sends it back to `o2f-client` using the tcp channel opened in step 2.
7. [container] `o2f-client` makes a GET requested for the redirect url it just received.
8. [container] The http service setup by the CLI tool receives the redirect requests, extracts the code, and uses it.

## Installation and Usage

This helper is written in Typescript and compiles down to two Javascript scripts, one for the server and one for the client.

### Download

Download the latest release from this repo. The release consists of a filed named `oauth2-forwarder.zip` which contains two Javascript scripts: `o2f-server.js` and `o2f-client.js` plus a helper `browser.sh` script, all in a directory called `o2f`. These can be placed wherever you want, but these instructions assume they are placed in the home directories of the host and container.

### On the host

Run `node ~/of2-server.js`. This will launch the server and it will listen for TCP connections on localhost at a random port which will be displayed in the console. You will need to keep this console/terminal open.

Notes:

- You can tell it to use a specific port by setting the environmental variable `OAUTH2_FORWARDER_PORT`

### In the container

Run `export OAUTH2_FORWARDER_SERVER="host.docker.internal:PORT` where PORT is replaced with the port displayed when you ran the server.

Run `export BROWSER=~/o2f/browser.sh` to set an environmental variable that will intercept attemps to open the system browser. If you've moved the `o2f` directory you'll need to change this variable setting appropriately.

NB: This works for a linux container that uses the BROWSER variable to determine how to handle requests to open things in a browser, for example, like those created by the npm `open` library. If you have a different setup your mileage my vary. Feel free to raise an issue here to get help.

Run your oauth2 CLI app as normal.

Notes:

- You can turn on more verbose debugging information by setting the environmental variable `OAUTH2_FORWARDER_DEBUG` to `true`. The logging on the client side is saved in `/tmp/oauth2-forwarder.log`. On the server side it is output to the console.

### Using a Dockerfile

Here's a strategy to make this fairly easy to use with a Docker container built with a Dockerfile.

On the host, set a specific port that you will listen on by configuring the env variable `OAUTH2_FORWARDER_PORT`.

Add these lines in the Dockerfile

```
RUN curl -LO https://github.com/sam-mfb/oauth2-forwarder/releases/download/v[VERSION]/oauth2-forwarder.zip
RUN unzip oauth2-forwarder.zip
ENV OAUTH2_FORWARDER_SERVER host.docker.internal:[PORT]
ENV BROWSER ~/o2f/browser.sh
```

Of course, replace `[VERSION]` and `[PORT]` with the actual version number and port number (or use Docker's `ARG` command).

## Debugging

You can enable debugging on either the server or the client by setting the environmental variable `OAUTH2_FORWARDER_DEBUG` to `true`.

## Security

Since this is using all localhost tcp communications the security model is the same using this tool as it is in the non-containerized solution. In other words, in both cases the received auth code is transmitted over plaintext tcp on the localhost only. NB: you could modify this tool to send the client<-->server traffic across the network, but that would not be a good idea.

NB: If you believe there is a security issue with the app, please reach out to me directly via email, which is just `sam` at my company's domain.
