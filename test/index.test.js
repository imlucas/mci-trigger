var trigger = require('../');

// @todo: use ./fixtures/*.json to mock backend? or use one of the VCR modules?

describe('mci-trigger', function(){
  it('should work', function(done){
    var server = trigger.listen(function(){
      server.close();
      done();
    });
  });
});
