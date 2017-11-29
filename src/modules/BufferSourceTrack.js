/*

  Web Audio API: Buffer Source track

*/
import WebAudioTrack from './WebAudioTrack'
import utils from './utils'

import nodes from './nodes/allNodes'

class BufferSourceTrack extends WebAudioTrack {
  constructor(params){
    super(params)
    let track = this

    let defaults = {
      id:       '',
      src:      '',
      volume:   1,
      start:    0,
      loop:     false,
      autoplay: false,
      autoload: true,
      context:  false,
      mix:      false,
      nodes:    [],
    }

    track.options = Object.assign(defaults, params)

    track.status = {
      ready: false,
      shouldPlayOnLoad: false,

      playing:  false,
      muted:    false,
    }

    // internal flags and data
    track.data = {

      // manual time tracking
      cachedTime: 0,
      startTime:  0,
    }

    if(!track.options.context){
      throw new Error('Can’t create a WebAudioTrack without Web Audio API support')
    }

    if(!track.options.src){
      throw new Error('Can’t create a WebAudioTrack without a src parameter')
    }

    // limited subset of events available because they're all simulated
    let eventNames = [
      'loadstart', 'loadedmetadata',
      'canplay', 'canplaythrough',
      'play', 'pause',
      'ended',
      'error',
    ]

    // load the source the right away, even if autoplay isn't set.
    if(track.options.autoload || track.options.autoplay){
      track.load()
    }

  }

  /*

    Playback needs to wait for the track to be loaded.
    After this, it's a synchronous function.

    You can listen for the 'canplaythrough' event to ensure
    synchronous playback of multiple buffer tracks.

  */
  play(){
    let track = this

    // this logic accomodates calling play() multiple times
    // while waiting for the track to be set up

    if(track.status.playing)
      return track

    if(!track.status.ready){

      if(!track.options.autoload && !track.status.shouldPlayOnLoad){
        track.load()
      }

      track.status.shouldPlayOnLoad = true

      return track
    }

    /*

      if we got this far we're actually ready to play, let's go!

    */

    let ctx = track.options.context

    // the buffer needs to be re-created every time we play()
    track.data.source  = ctx.createBufferSource()
    track.data.source.buffer = track.data.decodedBuffer

    // track.data.source.loop = (track.options.loop) ? true : false

    // as do the nodes
    let nodes = ['GainNode'].concat(track.options.nodes || [])
    super.createNodes(nodes, track.data.source)

    // set up timers, for the ended event
    track.data.startTime = track.data.source.context.currentTime - track.data.cachedTime
    var startFrom = track.data.cachedTime || 0

    // prefer start() but fall back to older, deprecated noteOn()
    if(typeof track.data.source.start === 'function'){
      track.data.source.start(0, startFrom)
    } else {
      track.data.source.noteOn(startFrom)
    }

    track.setEndTimer()

    track.status.playing = true
    super.trigger('play', track)

    return track

  }

  /*

    Buffer source mode requires the source file to be fully loaded
    and decoded before it can be play, so here we fetch it.

    Web Audio API has the same browser support as fetch (no IE,
    not even 11), so we can use this delightful method.

  */
  load(){
    let track = this
    let ctx = track.options.context

    super.trigger('loadstart')

    return window.fetch(track.options.src)
      .then(audioData => {
        track.data.audioData = audioData

        // Decode audio data
        if(typeof ctx.createGain === 'function') {

          // W3C standard implementation - async (Firefox, recent Chrome)
          return new Promise(function(resolve, reject){
            ctx.decodeAudioData(audioData, function(decodedBuffer){
              track.data.decodedBuffer = decodedBuffer
              resolve()
            })
          })

        } else if(typeof ctx.createGainNode === 'function') {

          // Non-standard Webkit implementation (Safari, old Chrome)
          // not async but we fake it for consistency
          let decodedBuffer = ctx.createBuffer(audioData, true)
          track.data.decodedBuffer = decodedBuffer
          return Promise.resolve()
        }

      })

      .then(() => {

        track.status.ready = true

        // now that the source is decoded, we know its duration
        super.trigger('loadedmetadata')
        super.trigger('canplay')
        super.trigger('canplaythrough')

        if(track.options.autoplay || track.status.shouldPlayOnLoad){
          track.play()
        }

      })
  }



  /*

    Buffer tracks don't have an ended event so we simulate it using setTimeout

  */

  setEndTimer(){
    let track = this
    let startFrom = track.data.cachedTime || 0
    track.data.timerDuration = (track.data.source.buffer.duration - startFrom)

    if(track.data.onendtimer){
      window.clearTimeout(track.data.onendtimer)
    }

    track.data.onendtimer = window.setTimeout(track.ended.bind(track), track.data.timerDuration * 1000)
  }

  ended() {
    let track = this
    if(track.options.loop){
      super.trigger('loop', track)
      track.pause(0)
      track.play()
    } else {
      super.trigger('ended', track)
    }
  }



  // end of play functions
  // ********************************************************






  pause(pauseAtTime){
    let track = this

    // disable autoplay, if we've paused the track before it's had a chance to load
    if(!track.status.playing && track.status.shouldPlayOnLoad){
      track.status.shouldPlayOnLoad = false
      track.options.autoplay = false
      return track
    }

    track.data.cachedTime = (typeof pauseAtTime === 'number' ? pauseAtTime : track.currentTime())

    track.status.playing = false

    if(track.data.onendtimer) window.clearTimeout(track.data.onendtimer)

    // prefer stop(), fallback to deprecated noteOff()
    if(typeof track.data.source.stop === 'function')
      track.data.source.stop(0)
    else if(typeof track.data.source.noteOff === 'function')
      track.data.source.noteOff(0)

    super.trigger('pause', track)

    return track
  }

  currentTime(setTo) {
    let track = this

    if(typeof setTo === 'number') {

      if(!track.status.ready){
        console.warn(`Can’t set currentTime for track ${track.options.id} before it loads. Listen for the 'canplaythrough' or 'play' events.`)
        return track
      }

      if(track.status.playing) {
        // to seek a buffer track, we need to pause and play
        pause(setTo).play()
      } else {
        track.data.cachedTime = setTo
      }
      return track
    }

    if(!track.status.ready || !track.status.playing)
      return track.data.cachedTime || 0

    return (track.data.source.context.currentTime - track.data.startTime) || 0

  }

  formattedTime(includeDuration){
    let track = this
    if(includeDuration)
      return utils.timeFormat(track.currentTime()) + '/' + utils.timeFormat(track.duration());
    else
      return utils.timeFormat(track.currentTime());
  }

  duration(){
    let track = this

    if(!track.status.ready){ return 0 }

    return track.data.source.buffer.duration || 0
  }

  // for a buffer track, volume() is basically an alias for the gain node
  volume(setTo){
    let track = this

    if(typeof setTo === 'number') {
      setTo = utils.normalize(setTo)

      if(track.status.muted) {
        gainCache(setTo)    // cache the value
        track.data.gain = 0
      } else {
        track.data.gain = setTo
      }

      if(status.playing){
        let gainNode = track.node('GainNode')

        if(gainNode)
          gainNode.gain.value = track.data.gain * track.options.mix.volume()
      }

      // if element source, also adjust the media element,
      // because the gain node is meaningless in this context
      if(options.sourceMode === 'element')
        element.volume = track.data.gain * track.options.mix.volume()

      // setters should be chainable
      events.trigger('gain', track);
      return track;
    }

  }

  tweenVolume(){

  }

  muted(){

  }

}

module.exports = BufferSourceTrack