#!/usr/bin/env node

require('../').listen({}, function(err){
  if(err){
    console.error(err);
    return process.exit(1);
  }
  console.log('mci-trigger: listening');
});
