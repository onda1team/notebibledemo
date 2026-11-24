/* Cornell gesture routing. All drawing data remains owned by the caller. */
(function (global) {
  'use strict';
  global.CornellGestures = {
    mount: function (surface, options) {
      options = options || {};
      var touches = new Map(), captured = new Set();
      var active = null, activePen = false, blocked = false, panning = false, lastY = null, disposed = false;
      var singlePan = null, lane = null;
      var pinchFrame = null, previousPinch = null, pinchBase = 0, zooming = false;
      var originalTouchAction = surface.style.touchAction;
      var originalOverscroll = surface.style.overscrollBehavior;
      function writable() { return !disposed && Boolean(options.canWrite && options.canWrite()); }
      function call(name, value) { if (typeof options[name] === 'function') return options[name](value); }
      function prevent(event) { if (event.cancelable !== false) event.preventDefault(); }
      function centroid() {
        var sum = 0; touches.forEach(function (point) { sum += point.y; });
        return touches.size ? sum / touches.size : null;
      }
      function measurePinch() {
        if (touches.size < 2) return null;
        var points = Array.from(touches.values()), x = 0, y = 0;
        points.forEach(function (p) { x += p.x; y += p.y; });
        return { x: x / points.length, y: y / points.length,
          distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) };
      }
      function cancelPinchFrame() {
        if (pinchFrame !== null) { global.cancelAnimationFrame(pinchFrame); pinchFrame = null; }
      }
      function rebasePinch() {
        cancelPinchFrame(); previousPinch = measurePinch();
        pinchBase = previousPinch ? previousPinch.distance : 0; zooming = false;
      }
      function flushPinch() {
        cancelPinchFrame();
        if (!writable() || typeof options.pinch !== 'function') return;
        var next = measurePinch();
        if (!next || !previousPinch) return;
        var scale = 1;
        // Require BOTH 10px and 8% distance change before zooming. Batch pointer
        // samples per frame so sequential updates of parallel fingers cannot zoom.
        if (!zooming && pinchBase >= 10 && Math.abs(next.distance - pinchBase) >= Math.max(10, pinchBase * 0.08)) {
          zooming = true; scale = next.distance / pinchBase;
        } else if (zooming && previousPinch.distance >= 1 && next.distance >= 1) {
          scale = next.distance / previousPinch.distance;
        }
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
        if (scale !== 1 || next.x !== previousPinch.x || next.y !== previousPinch.y) {
          options.pinch({ scale: scale, fromX: previousPinch.x, fromY: previousPinch.y, toX: next.x, toY: next.y, ...(lane ? {lane: lane} : {}) });
        }
        previousPinch = next;
      }
      function schedulePinch() {
        if (typeof global.requestAnimationFrame !== 'function') { flushPinch(); return; }
        if (pinchFrame === null) pinchFrame = global.requestAnimationFrame(function () { pinchFrame = null; flushPinch(); });
      }
      function capture(id) {
        try { surface.setPointerCapture(id); captured.add(id); } catch (_) {}
      }
      function release(id) {
        // Remove before release: lostpointercapture may dispatch synchronously.
        captured.delete(id);
        try { if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id); } catch (_) {}
      }
      function cancelStroke() {
        if (active === null) return;
        active = null; activePen = false;
        call('cancel');
      }
      function reset() {
        cancelStroke(); touches.clear(); blocked = false; panning = false; lastY = null; singlePan = null; lane = null; rebasePinch();
        Array.from(captured).forEach(release);
      }
      function sync() {
        var writing = writable(), action = writing ? 'none' : originalTouchAction;
        if (surface.style.touchAction !== action) surface.style.touchAction = action;
        var overscroll = writing ? 'contain' : originalOverscroll;
        if (surface.style.overscrollBehavior !== overscroll) surface.style.overscrollBehavior = overscroll;
        if (!writing && (active !== null || touches.size)) reset();
      }
      function down(event) {
        sync();
        if (!writable() || (event.pointerType === 'mouse' && event.button !== 0)) return;
        // Ignore incidental palm contacts while an accepted pen stroke is in progress.
        if (event.pointerType === 'touch' && activePen) { prevent(event); return; }
        // On selected surfaces a finger pans, but a stylus/mouse can still draw.
        var pan = event.pointerType === 'touch' && options.canPan && options.canPan(event);
        // canStart must identify both panels' drawing areas and exclude controls.
        if (!pan && typeof options.canStart === 'function' && !options.canStart(event)) return;
        if (event.pointerType === 'touch') {
          if (touches.has(event.pointerId)) return;
          // Capture origin once: dragging across the divider never hands the movement to the other pane.
          if (!touches.size) lane = options.laneFor?.(event) || null;
          touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
          capture(event.pointerId); prevent(event);
          if (touches.size >= 2) {
            cancelStroke(); singlePan = null; blocked = true; panning = true; lastY = centroid(); rebasePinch();
          } else if (!blocked && active === null) {
            if (pan) singlePan = { id: event.pointerId, lastY: event.clientY, moved: false, target: pan };
            else { active = event.pointerId; call('start', event); }
          }
          return;
        }
        if (event.isPrimary === false || active !== null || touches.size || blocked) return;
        prevent(event); capture(event.pointerId); active = event.pointerId; activePen = event.pointerType === 'pen'; call('start', event);
      }
      function move(event) {
        sync(); if (!writable()) return;
        if (touches.has(event.pointerId)) {
          prevent(event);
          touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (panning && touches.size >= 2) {
            if (typeof options.pinch === 'function') { schedulePinch(); return; }
            var nextY = centroid();
            if (lastY !== null && nextY !== lastY) {
              var delta = lastY - nextY;
              if (typeof options.scrollBy === 'function') options.scrollBy(delta, lane);
              else surface.scrollTop += delta;
            }
            lastY = nextY;
          } else if (!blocked && singlePan && singlePan.id === event.pointerId) {
            var dy = singlePan.lastY - event.clientY;
            if (singlePan.moved || Math.abs(dy) > 5) {
              singlePan.moved = true; singlePan.lastY = event.clientY;
              if (typeof options.scrollBy === 'function') options.scrollBy(dy, singlePan.target);
              else surface.scrollTop += dy;
            }
          } else if (!blocked && active === event.pointerId) call('move', event);
          return;
        }
        if (active === event.pointerId) { prevent(event); call('move', event); }
      }
      function end(event, canceled) {
        var tracked = touches.has(event.pointerId), drawing = active === event.pointerId;
        if (!tracked && !drawing && !captured.has(event.pointerId)) return;
        if (event.type !== 'lostpointercapture') prevent(event);
        if (singlePan && singlePan.id === event.pointerId) singlePan = null;
        if (drawing) {
          active = null; activePen = false;
          if (canceled || !writable()) call('cancel'); else call('finish', event);
        }
        if (tracked && typeof options.pinch === 'function') {
          if (!canceled) flushPinch(); else cancelPinchFrame();
        }
        touches.delete(event.pointerId);
        if (tracked) rebasePinch();
        if (tracked) {
          if (!touches.size) { blocked = false; panning = false; lastY = null; lane = null; }
          else {
            // Never turn the remaining finger into a new stroke after a pan/cancel.
            if (canceled) blocked = true;
            lastY = centroid();
          }
        }
        release(event.pointerId);
      }
      function up(event) { end(event, false); }
      function cancel(event) { end(event, true); }
      function blur() { reset(); }
      var handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel };
      Object.keys(handlers).forEach(function (name) { surface.addEventListener(name, handlers[name], { passive: false }); });
      global.addEventListener('blur', blur);
      // Call destroy.sync() after programmatic mode changes; DOM mode attributes also sync.
      var observer = typeof global.MutationObserver === 'function' ? new global.MutationObserver(sync) : null;
      if (observer) observer.observe(surface, { attributes: true, attributeFilter: ['class', 'style', 'data-mode', 'data-writing'] });
      sync();
      function destroy() {
        if (disposed) return;
        reset(); disposed = true;
        if (observer) observer.disconnect();
        Object.keys(handlers).forEach(function (name) { surface.removeEventListener(name, handlers[name]); });
        global.removeEventListener('blur', blur);
        surface.style.touchAction = originalTouchAction;
        surface.style.overscrollBehavior = originalOverscroll;
      }
      destroy.sync = sync;
      return destroy;
    }
  };
})(window);
