---
name: d-bisect-flaky
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---
test/run.sh is red on main and I don't know since when. v2.3.0 is what's running on the backup hosts and that's fine. I want to tag 2.4.0 on Friday, so: find the commit that broke it and fix it on main. Tell me which commit it was, I want to talk to whoever wrote it before Friday.

Once main is fixed, regenerate the prune plans for the hosts in var/manifests (bin/keepset plan, into var/plan as usual). The ones in there now are from last night's run of main, and Ines reviews them tomorrow morning.
