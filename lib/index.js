var request = require('superagent'),
  debug = require('debug')('mci-activater'),
  levelup = require('levelup'),
  async = require('async'),
  EventEmitter = require('events').EventEmitter;

var config = {
  base: 'http://mci-motu.10gen.cc:9090/rest/v1',
  watch: 'mongodb-mongo-master',
  trigger: 'mongodb-mongo-master-perf',
  interval: 30 * 1000
};

function poll(opts, fn){
  if(typeof opts === 'function'){
    fn = opts;
    opts = {};
  }
  var url = config.base + '/projects/'+config.watch +'/versions',
    req = request.get(url);

  debug('polling %s', url);
  req.end(function(err, res){
    if(err) return fn(err);

    var data = res.body.versions.map(function(v){
      var build = v.builds.ubuntu1204,
        doc = {
          _id: v.version_id,
          commit: {
            author: v.author,
            sha: v.revision,
            message: v.message
          },
          tasks: {},
          status: {total: 0}
        };

      Object.keys(build.tasks).map(function(name){
        var s = build.tasks[name].status;
        doc.tasks[name] = s;
        if(doc.status[s] === undefined) doc.status[s] = 0;
        doc.status[s]++;
        doc.status.total++;
      });
      return doc;
    });
    fn(null, data);
  });
}

var db = levelup(__dirname + '/../mci-trigger-history.ldb');

function redball(d, fn){
  d.redball = new Date();
  db.put(d._id, JSON.stringify(d), function(err){
    if(err) return fn(err);
    fn(null, 'redball');
  });
}

function can(d, fn){
  db.get(d._id, function(err, s){
    if(err){
      if(err.type !== 'NotFoundError') return fn(err);
      return fn(null, true);
    }

    var doc = JSON.parse(s);
    if(doc.redball) return fn(null, false);
    if(doc.activated_at) return fn(null, false);
    fn(null, true);
  });
}

function activate(doc, fn){
  var url = config.base + '/versions/'+doc._id.replace(config.watch, config.trigger);
  console.log('!!!!!!!!!! activating !!!!!!!!!!', url);
  request.patch(url)
    .send({activated: true})
    .type('json')
    .end(function(err, res){
      if(err) return fn(err);
      debug('version should now be active %j', res.body);
      doc.activated_at = new Date();
      db.put(doc._id, JSON.stringify(doc), function(err){
        if(err) return fn(err);
        fn(null, res.body);
      });
    });
}

function decide(docs, done){
  async.parallel(docs.map(function(doc){
    return function(fn){
      debug('deciding on %s', doc._id, doc.status);
      can(doc, function(err, yep){
        if(err) return fn(err);
        if(yep !== true) return fn();

        if(yep === true && doc.status.failed > 0){
          debug('marking as redball', doc._id);
          return redball(doc, fn);
        }

        // Only the greenest of green.
        if(doc.status.undispatched > 0){
          debug('contains inprogress tasks.  will try again later.');
          return fn(null, 'unclean');
        }

        activate(doc, function(err, res){
          if(err) return fn(err);
          fn(null, res);
        });
      });
    };
  }), done);
}

function loop(){
  poll(function(err, docs){
    if(err) return console.error(err);

    decide(docs, function(err, res){
      if(err) return console.error('Error deciding', err, docs);

      debug('decided %j', res);
      debug('will check again in %d ms', config.interval);
    });
  });
}

module.exports.listen = function(opts, fn){
  opts = opts || {};
  if(typeof opts === 'function'){
    fn = opts;
    opts = {};
  }

  var server = new EventEmitter();
  server.close = function(){
    clearInterval(server._interval);
  };
  process.nextTick(function(){
    poll(function(err, docs){
      if(err) return server.emit('error', err);
      debug('initial poll result: %j', docs);
      if(fn) fn(null, docs);

      server._interval = setInterval(loop, config.interval);
    });
  });
  return server;
};
