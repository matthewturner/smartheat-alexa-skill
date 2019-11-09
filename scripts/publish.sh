#!/bin/sh

aws lambda update-function-code \
    --function-name SmartHeat \
    --zip-file fileb://scripts/package.zip \
    --profile salus