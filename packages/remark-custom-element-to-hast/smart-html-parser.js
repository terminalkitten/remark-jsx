'use strict';

var blockElements = require('remark-parse/lib/block-elements.json');

function getAllMatches(regexp, value) {
  var r = new RegExp(regexp, 'g');
  var matches = [];
  var singleMatch;
  var minValidIndex = 0;
  while ((singleMatch = r.exec(value)) !== null) {
    if (singleMatch.index >= minValidIndex) {
      minValidIndex = singleMatch.index + singleMatch[0].length;
      matches.push(singleMatch);
    }
  }
  return matches;
}

function partialTokenizer(subParser, valueDesc) {
  var matches = subParser(valueDesc);
  var rawFragments = matches.reduce(function (acc, current) {
    var fragments = acc.fragments;
    var lastEndsAt = acc.lastEndsAt;
    if (current.startsAt !== lastEndsAt) {
      fragments.push({
        type: 'raw',
        value: valueDesc.value.substring(lastEndsAt - valueDesc.startsAt, current.startsAt - valueDesc.startsAt),
        startsAt: lastEndsAt,
        endsAt: current.startsAt
      });
    }
    return {
      fragments: fragments,
      lastEndsAt: current.endsAt
    };
  }, {
    fragments: [],
    lastEndsAt: valueDesc.startsAt
  });
  if (rawFragments.lastEndsAt !== valueDesc.endsAt) {
    rawFragments.fragments.push({
      type: 'raw',
      value: valueDesc.value.substring(rawFragments.lastEndsAt - valueDesc.startsAt),
      startsAt: rawFragments.lastEndsAt,
      endsAt: valueDesc.endsAt
    });
  }
  Array.prototype.push.apply(matches, rawFragments.fragments);
  matches.sort(function (a, b) {
    return a.startsAt - b.startsAt;
  });
  return matches;
}

function pipeTokenizers(tokenizers, value) {
  function applyNext(tokens, next) {
    return Array.prototype.concat.apply([], tokens.map(function (t) {
      return t.type === 'raw' ? next(t) : t;
    }));
  }
  return tokenizers.reduce(applyNext, [{
    type: 'raw',
    value: value,
    startsAt: 0,
    endsAt: value.length
  }]);
}

var attributeName = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
var unquoted = '([^"\'=<>`\\u0000-\\u0020]+)';
var singleQuoted = '\'((?:\\\\.|[^\\\'])*)(\')';
var doubleQuoted = '"((?:\\\\.|[^\\"])*)(")';
var attributeValue = '(?:' + unquoted + '|' + singleQuoted + '|' + doubleQuoted + ')';
var attribute = '(?:\\s+' + attributeName + '(?:\\s*=\\s*' + attributeValue + ')?)';

function smartHtmlParser(componentWhitelist) {
  var components = blockElements.concat(componentWhitelist).join('|');

  function parseOpeningTags(valueDesc) {
    return partialTokenizer(function (valueDesc) {
      var regexp = '<(' + components + ')(' + attribute + '*)\\s*(/?)>';
      var propertiesRegex = '(' + attributeName + ')(?:\\s*=\\s*' + attributeValue + ')?';
      var matches = getAllMatches(regexp, valueDesc.value).map(function (match) {
        return {
          value: match[0],
          type: match[8] ? 'autoCloseTag' : 'openTag',
          tagName: match[1],
          startsAt: match.index + valueDesc.startsAt,
          endsAt: valueDesc.startsAt + match.index + match[0].length,
          properties: getAllMatches(propertiesRegex, match[2]).reduce(function (props, m) {
            var value = m[2] || m[3] || m[5];
            var quote = m[4] || m[6];
            var unescapedValue = quote ? value.replace(new RegExp('\\\\' + quote, 'g'), quote) : value;
            props[m[1]] = value === undefined ? true : unescapedValue;
            return props;
          }, {})
        };
      });
      return matches;
    }, valueDesc);
  }

  function parseClosingTags(valueDesc) {
    return partialTokenizer(function (valueDesc) {
      var regexp = '</(' + components + ')\\s*>';
      var matches = getAllMatches(regexp, valueDesc.value).map(function (match) {
        return {
          value: match[0],
          type: 'closingTag',
          tagName: match[1],
          startsAt: match.index + valueDesc.startsAt,
          endsAt: valueDesc.startsAt + match.index + match[0].length
        };
      });
      return matches;
    }, valueDesc);
  }

  function parse(value, rawTransformer) {
    var tokens = pipeTokenizers([
      parseOpeningTags,
      parseClosingTags
    ], value);

    var tree = tokens.reduce(function (stack, t) {
      var element;
      switch (t.type) {
        case 'closingTag':
          element = stack.pop();
          if (element.tagName !== t.tagName) {
            throw new Error();
          }
          element.endsAt = t.endsAt;
          element.innerEndsAt = t.startsAt;
          break;
        case 'openTag':
          element = {
            type: 'element',
            tagName: t.tagName,
            properties: t.properties,
            children: [],
            startsAt: t.startsAt,
            innerStartsAt: t.endsAt
          };
          stack[stack.length - 1].children.push(element);
          stack.push(element);
          break;
        case 'autoCloseTag':
          element = {
            type: 'element',
            tagName: t.tagName,
            properties: t.properties,
            children: [],
            startsAt: t.startsAt,
            endsAt: t.endsAt
          };
          stack[stack.length - 1].children.push(element);
          break;
        default:
          /*
           The default rawTransformer should return something in the line of
           {
            type: 'text',
            value: t.value,
            startsAt: t.startsAt,
            endsAt: t.endsAt
          }
           */
          element = rawTransformer(t);
          Array.prototype.push.apply(stack[stack.length - 1].children, element);
          break;
      }
      return stack;
    }, [{
      type: 'root',
      children: []
    }])[0];
    return tree;
  }
  return parse;
}

module.exports = smartHtmlParser;
