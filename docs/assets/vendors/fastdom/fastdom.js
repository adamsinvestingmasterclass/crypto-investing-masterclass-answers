!(function(win) {

  /**
   * FastDom
   *
   * Eliminates layout thrashing
   * by batching DOM read/write
   * interactions.
   *
   * @author Wilson Page <wilsonpage@me.com>
   * @author Kornel Lesinski <kornel.lesinski@ft.com>
   */
  
  'use strict';
  
  /**
   * Mini logger
   *
   * @return {Function}
   */
  var debug = 0 ? console.log.bind(console, '[fastdom]') : function() {};
  
  /**
   * Normalized rAF
   *
   * @type {Function}
   */
  var raf = win.requestAnimationFrame
    || win.webkitRequestAnimationFrame
    || win.mozRequestAnimationFrame
    || win.msRequestAnimationFrame
    || function(cb) { return setTimeout(cb, 16); };
  
  /**
   * Initialize a `FastDom`.
   *
   * @constructor
   */
  function FastDom() {
    var self = this;
    self.reads = [];
    self.writes = [];
    self.raf = raf.bind(win); // test hook
    debug('initialized', self);
  }
  
  FastDom.prototype = {
    constructor: FastDom,
  
    /**
     * We run this inside a try catch
     * so that if any jobs error, we
     * are able to recover and continue
     * to flush the batch until it's empty.
     *
     * @param {Array} tasks
     */
    runTasks: function(tasks) {
      debug('run tasks');
      var task; while (task = tasks.shift()) task();
    },
  
    /**
     * Adds a job to the read batch and
     * schedules a new frame if need be.
     *
     * @param  {Function} fn
     * @param  {Object} ctx the context to be bound to `fn` (optional).
     * @public
     */
    measure: function(fn, ctx) {
      debug('measure');
      var task = !ctx ? fn : fn.bind(ctx);
      this.reads.push(task);
      scheduleFlush(this);
      return task;
    },
  
    /**
     * Adds a job to the
     * write batch and schedules
     * a new frame if need be.
     *
     * @param  {Function} fn
     * @param  {Object} ctx the context to be bound to `fn` (optional).
     * @public
     */
    mutate: function(fn, ctx) {
      debug('mutate');
      var task = !ctx ? fn : fn.bind(ctx);
      this.writes.push(task);
      scheduleFlush(this);
      return task;
    },
  
    /**
     * Clears a scheduled 'read' or 'write' task.
     *
     * @param {Object} task
     * @return {Boolean} success
     * @public
     */
    clear: function(task) {
      debug('clear', task);
      return remove(this.reads, task) || remove(this.writes, task);
    },
  
    /**
     * Extend this FastDom with some
     * custom functionality.
     *
     * Because fastdom must *always* be a
     * singleton, we're actually extending
     * the fastdom instance. This means tasks
     * scheduled by an extension still enter
     * fastdom's global task queue.
     *
     * The 'super' instance can be accessed
     * from `this.fastdom`.
     *
     * @example
     *
     * var myFastdom = fastdom.extend({
     *   initialize: function() {
     *     // runs on creation
     *   },
     *
     *   // override a method
     *   measure: function(fn) {
     *     // do extra stuff ...
     *
     *     // then call the original
     *     return this.fastdom.measure(fn);
     *   },
     *
     *   ...
     * });
     *
     * @param  {Object} props  properties to mixin
     * @return {FastDom}
     */
    extend: function(props) {
      debug('extend', props);
      if (typeof props != 'object') throw new Error('expected object');
  
      var child = Object.create(this);
      mixin(child, props);
      child.fastdom = this;
  
      // run optional creation hook
      if (child.initialize) child.initialize();
  
      return child;
    },
  
    // override this with a function
    // to prevent Errors in console
    // when tasks throw
    catch: null
  };
  
  /**
   * Schedules a new read/write
   * batch if one isn't pending.
   *
   * @private
   */
  function scheduleFlush(fastdom) {
    if (!fastdom.scheduled) {
      fastdom.scheduled = true;
      fastdom.raf(flush.bind(null, fastdom));
      debug('flush scheduled');
    }
  }
  
  /**
   * Runs queued `read` and `write` tasks.
   *
   * Errors are caught and thrown by default.
   * If a `.catch` function has been defined
   * it is called instead.
   *
   * @private
   */
  function flush(fastdom) {
    debug('flush');
  
    var writes = fastdom.writes;
    var reads = fastdom.reads;
    var error;
  
    try {
      debug('flushing reads', reads.length);
      fastdom.runTasks(reads);
      debug('flushing writes', writes.length);
      fastdom.runTasks(writes);
    } catch (e) { error = e; }
  
    fastdom.scheduled = false;
  
    // If the batch errored we may still have tasks queued
    if (reads.length || writes.length) scheduleFlush(fastdom);
  
    if (error) {
      debug('task errored', error.message);
      if (fastdom.catch) fastdom.catch(error);
      else throw error;
    }
  }
  
  /**
   * Remove an item from an Array.
   *
   * @param  {Array} array
   * @param  {*} item
   * @return {Boolean}
   */
  function remove(array, item) {
    var index = array.indexOf(item);
    return !!~index && !!array.splice(index, 1);
  }
  
  /**
   * Mixin own properties of source
   * object into the target.
   *
   * @param  {Object} target
   * @param  {Object} source
   */
  function mixin(target, source) {
    for (var key in source) {
      if (source.hasOwnProperty(key)) target[key] = source[key];
    }
  }
  
  // There should never be more than
  // one instance of `FastDom` in an app
  var exports = win.fastdom = (win.fastdom || new FastDom()); // jshint ignore:line
  
  // Expose to CJS & AMD
  if ((typeof define) == 'function') define(function() { return exports; });
  else if ((typeof module) == 'object') module.exports = exports;
  
})( typeof window !== 'undefined' ? window : this);

!(function() {

  /**
   * Wraps fastdom in a Promise API
   * for improved control-flow.
   *
   * @example
   *
   * // returning a result
   * fastdom.measure(() => el.clientWidth)
   *   .then(result => ...);
   *
   * // returning promises from tasks
   * fastdom.measure(() => {
   *   var w = el1.clientWidth;
   *   return fastdom.mutate(() => el2.style.width = w + 'px');
   * }).then(() => console.log('all done'));
   *
   * // clearing pending tasks
   * var promise = fastdom.measure(...)
   * fastdom.clear(promise);
   *
   * @type {Object}
   */
  var exports = {
    initialize: function() {
      this._tasks = new Map();
    },
  
    mutate: function(fn, ctx) {
      return create(this, 'mutate', fn, ctx);
    },
  
    measure: function(fn, ctx) {
      return create(this, 'measure', fn, ctx);
    },
  
    clear: function(promise) {
      var tasks = this._tasks;
      var task = tasks.get(promise);
      this.fastdom.clear(task);
      tasks.delete(promise);
    }
  };
  
  /**
   * Create a fastdom task wrapped in
   * a 'cancellable' Promise.
   *
   * @param  {FastDom}  fastdom
   * @param  {String}   type - 'measure'|'muatate'
   * @param  {Function} fn
   * @return {Promise}
   */
  function create(promised, type, fn, ctx) {
    var tasks = promised._tasks;
    var fastdom = promised.fastdom;
    var task;
  
    var promise = new Promise(function(resolve, reject) {
      task = fastdom[type](function() {
        tasks.delete(promise);
        try { resolve(ctx ? fn.call(ctx) : fn()); }
        catch (e) { reject(e); }
      }, ctx);
    });
  
    tasks.set(promise, task);
    return promise;
  }
  
  // Expose to CJS, AMD or global
  if ((typeof define)[0] == 'f') define(function() { return exports; });
  else if ((typeof module)[0] == 'o') module.exports = exports;
  else window.fastdomPromised = exports;
  
})();

window.fastdomPromised = fastdom.extend(fastdomPromised);