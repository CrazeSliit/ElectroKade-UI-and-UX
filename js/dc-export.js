/* ElectroKade.lk export runtime: renders the design's templates with React.
   Supports {{holes}}, <template data-sc="if|for">, <dc-import>, and DCLogic components. */
(function () {
  var R = window.React, h = R.createElement;
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g, WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var EVENTS = { onclick: 'onClick', onchange: 'onChange', onfocus: 'onFocus', onblur: 'onBlur', onsubmit: 'onSubmit', oninput: 'onInput', onkeydown: 'onKeyDown', onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave', onmousemove: 'onMouseMove' };
  var ATTRS = { 'class': 'className', 'for': 'htmlFor', tabindex: 'tabIndex', maxlength: 'maxLength', inputmode: 'inputMode', autocomplete: 'autoComplete', readonly: 'readOnly', colspan: 'colSpan', rowspan: 'rowSpan', srcset: 'srcSet', viewbox: 'viewBox', autofocus: 'autoFocus' };
  var BOOL = { checked: 1, disabled: 1, selected: 1, hidden: 1, required: 1, multiple: 1, readOnly: 1, open: 1, autoFocus: 1 };
  var VOID = { img: 1, input: 1, br: 1, hr: 1, meta: 1, link: 1, source: 1, col: 1, area: 1, wbr: 1 };

  function camel(s) { return s.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); }
  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true; if (path === 'false') return false; if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    var parts = path.split('.');
    for (var i = scope.length - 1; i >= 0; i--) {
      var s = scope[i];
      if (s && Object.prototype.hasOwnProperty.call(s, parts[0])) {
        var v = s[parts[0]];
        for (var k = 1; k < parts.length; k++) v = v == null ? undefined : v[parts[k]];
        return v;
      }
    }
    return undefined;
  }
  function val(raw, scope) {
    if (raw == null) return raw;
    var m = raw.match(WHOLE);
    if (m) return lookup(m[1], scope);
    if (raw.indexOf('{{') < 0) return raw;
    return raw.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }
  function styleObj(str) {
    var o = {};
    String(str || '').split(';').forEach(function (decl) {
      var i = decl.indexOf(':'); if (i < 0) return;
      var p = decl.slice(0, i).trim(), v = decl.slice(i + 1).trim();
      if (!p) return;
      if (p.indexOf('--') === 0) { o[p] = v; return; }
      if (p.charAt(0) === '-') { p = camel(p.slice(1)); p = p.charAt(0).toUpperCase() + p.slice(1); } else p = camel(p);
      o[p] = v;
    });
    return o;
  }
  function flatten(list, out) {
    out = out || [];
    (Array.isArray(list) ? list : [list]).forEach(function (c) {
      if (Array.isArray(c)) flatten(c, out);
      else if (c && c.type === R.Fragment) flatten(c.props.children, out);
      else out.push(c);
    });
    return out;
  }
  function stripSelected(list) {
    return (Array.isArray(list) ? list : [list]).map(function (c) {
      if (Array.isArray(c)) return stripSelected(c);
      if (c && c.type === R.Fragment) return R.cloneElement(c, null, stripSelected(c.props.children));
      if (c && c.type === 'option' && 'selected' in c.props) { var p = Object.assign({}, c.props); delete p.selected; delete p.children; return h('option', p, c.props.children); }
      return c;
    });
  }

  function element(node, scope) {
    var tag = node.localName;
    if (tag === 'template') {
      var kind = node.getAttribute('data-sc'), kids = node.content.childNodes;
      if (kind === 'if') return val(node.getAttribute('value'), scope) ? build(kids, scope) : null;
      if (kind === 'for') {
        var list = val(node.getAttribute('list'), scope) || [], as = node.getAttribute('as') || 'item';
        return list.map(function (it, i) { var s = {}; s[as] = it; s.$index = i; return h(R.Fragment, { key: i }, build(kids, scope.concat([s]))); });
      }
      return null;
    }
    if (tag === 'dc-import') {
      var C = DC.reg[node.getAttribute('name')], cp = {};
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (a.name === 'name' || a.name.indexOf('hint-') === 0) return;
        cp[camel(a.name)] = val(a.value, scope);
      });
      return C ? h(C, cp) : null;
    }
    var props = {}, controlled = false, raws = {};
    Array.prototype.forEach.call(node.attributes, function (a) {
      var n = a.name, v = val(a.value, scope);
      if (EVENTS[n]) { if (typeof v === 'function') { props[EVENTS[n]] = v; if (n === 'onchange' || n === 'oninput') controlled = true; } return; }
      if (n === 'style') { props.style = styleObj(v); return; }
      var key = ATTRS[n] || (n.indexOf('aria-') === 0 || n.indexOf('data-') === 0 ? n : (n.indexOf('-') > 0 ? camel(n) : n));
      raws[key] = a.value;
      if (BOOL[key]) { props[key] = a.value === '' ? true : (v === 'false' ? false : !!v); return; }
      if (v == null) return;
      props[key] = v;
    });
    if (tag === 'input' || tag === 'textarea') {
      if (!controlled) {
        if ('value' in props) { props.defaultValue = props.value; delete props.value; }
        if ('checked' in props) { props.defaultChecked = props.checked; delete props.checked; }
      }
    }
    if (VOID[tag]) return h(tag, props);
    var children = build(node.childNodes, scope);
    if (tag === 'textarea') { if (!('defaultValue' in props) && !controlled) props.defaultValue = flatten(children).join(''); return h(tag, props); }
    if (tag === 'select') {
      var sel = flatten(children).filter(function (c) { return c && c.type === 'option' && c.props.selected; })[0];
      if (sel) { var sv = sel.props.value != null ? sel.props.value : flatten(sel.props.children).join(''); if (props.onChange) props.value = sv; else props.defaultValue = sv; }
      children = stripSelected(children);
    }
    return h.apply(null, [tag, props].concat(children));
  }

  function build(nodes, scope) {
    var out = [];
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.nodeType === 3) {
        var t = node.nodeValue;
        if (/^\s*$/.test(t) && t.indexOf('\n') >= 0) return;
        out.push(t.indexOf('{{') >= 0 ? t.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); }) : t);
      } else if (node.nodeType === 1) {
        out.push(element(node, scope));
      }
    });
    return out;
  }

  function base(tpl) {
    return class DCLogic extends R.Component {
      renderVals() { return {}; }
      render() { return h.apply(null, [R.Fragment, null].concat(build(tpl.content.childNodes, [this.renderVals() || {}]))); }
    };
  }

  var DC = window.DC = { reg: {} };
  DC.define = function (name, factory) { DC.reg[name] = factory(base(document.getElementById('dc-tpl-' + name))); };
  DC.mount = function (factory) {
    var Comp = factory(base(document.getElementById('dc-root')));
    ReactDOM.createRoot(document.getElementById('app')).render(h(Comp, {}));
  };
})();
