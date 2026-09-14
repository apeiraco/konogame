# Local daemon API

Run `just build` at the repository root, then `just daemon`. The default listener is `127.0.0.1:38417`. Set `KONOGAME_DAEMON_PORT` to select a port and `KONOGAME_SAVE_ROOT` to choose the save destination. Workspace roots and save source directories are absolute paths on the daemon host. POST requests use `Content-Type: application/json` and accept up to 1 MiB. If a discovery preview exceeds this budget, narrow the scan scope and preview again before admission.

Open `http://127.0.0.1:38417/api/openapi` to browse operations and send requests offline. Clients and code generators can fetch `GET /api/openapi.json` from the same server. The specification describes the paths, request fields and responses.

## Start with a read

This PowerShell example lists registered Features and shows which Adapter would inspect a Workspace.

~~~powershell
$base = "http://127.0.0.1:38417"
Invoke-RestMethod "$base/api/features"
Invoke-RestMethod "$base/api/plan" -Method Post -ContentType "application/json" -Body '{"features":["workspace.inspect"]}'
~~~

## Follow the workflow

- **Workspace**. Initialize an existing root. For edits, request a preview and submit it intact with an independently supplied root and confirmation. After a conflict, read again and review. If recovery is required, retain the operation ID and invoke the matching targeted recovery operation.
- **Games**. Use GET to read the library and individual games. Discovery previews require an existing Host, a configured source and an explicit scan scope. Admission requires the reviewed preview, selected candidates and confirmation. Scanning alone leaves the library untouched.
- **Saves**. Send a local directory to `POST /api/saves`. The daemon streams its files into storage and returns the Artifact reference. Only the directory information travels in the JSON request.
- **Extensions**. List contributions, inspect source and Adapter state, and refresh configured discovery sources. The refresh result distinguishes additions, replacements, removals and contributions requiring a restart.

The local API runs with the daemon process's filesystem access. Writes and recovery are intended for trusted local clients. See [ADR 0015](adr/0015-DAEMON-HTTP-BOUNDARY.md) for the framework decision and process boundary.

[English](009-DAEMON-API.md) | [中文](../zh/009-DAEMON-API.md)
