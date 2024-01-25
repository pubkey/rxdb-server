#!/bin/bash
set -e

RXDB_VERSION=$(cat ../package.json \
  | grep '"rxdb":' \
  | tail -1 \
  | awk -F: '{ print $2 }' \
  | sed 's/[",]//g' \
  | sed -e 's/^[[:space:]]*//'
)
