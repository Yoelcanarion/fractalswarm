# FractalSwarm: static showcase

This branch is the built static showcase of FractalSwarm, served by GitHub Pages at
https://yoelcanarion.github.io/fractalswarm/. It is generated, not edited by hand.

- **Source:** commit `719dff0` of `master`, from a clean working tree, built with

  ```
  python scripts/build_static_site.py --runs demo/final \
    --pair demo/same-second-durable-max-swarm:demo/same-second-durable-max-rival \
    --pair demo/same-second-central-swarm:demo/same-second-central-rival \
    --require-clean
  ```

- **What it holds:** the web app and five recorded runs, 24,871 events. The replay check of each run
  ran at build time, and the page recomputes the hash chain of a log in the browser.
- **What it does not hold:** a server, a key or a live run. To run it yourself, get the code and run
  `uv run fractalswarm demo --verify`.
- **Third-party material:** the Inter and JetBrains Mono fonts, under the SIL Open Font License. See
  `NOTICE` and `licenses/`.

The code, the benchmark and the report are on `master`.
