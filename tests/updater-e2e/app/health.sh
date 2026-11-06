#!/bin/sh
# Health check of the stand-in app: a broken release (HEALTHY=false) never passes.
[ "$HEALTHY" = true ] && wget -q -O /dev/null http://127.0.0.1:3000/
