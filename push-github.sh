#!/usr/bin/env bash

# Add github remote temporarily
if ! git remote | grep -q 'github'; then
  git remote add github git@github.com:cheq-ai/cheq-enforce-react.git
fi

# Push master and tags to github
git push github master --tags

# Remove github remote to prevent accidental pushes from other git operations
git remote remove github
