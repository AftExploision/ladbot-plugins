var util = require('../util/index'),

    ArgumentsError = require('../error/ArgumentsError'),

    isString = util.string.isString,
    isArray = Array.isArray,
    type = util.types.type,

    // types
    Complex = require('../type/Complex'),
    Matrix = require('../type/Matrix'),
    Unit = require('../type/Unit'),
    collection = require('../type/collection'),

    // scope and nodes
    ArrayNode = require('./node/ArrayNode'),
    AssignmentNode = require('./node/AssignmentNode'),
    BlockNode = require('./node/BlockNode'),
    ConditionalNode = require('./node/ConditionalNode'),
    ConstantNode = require('./node/ConstantNode'),
    FunctionNode = require('./node/FunctionNode'),
    IndexNode = require('./node/IndexNode'),
    OperatorNode = require('./node/OperatorNode'),
    ParamsNode = require('./node/ParamsNode'),
    RangeNode = require('./node/RangeNode'),
    SymbolNode = require('./node/SymbolNode'),
    UpdateNode = require('./node/UpdateNode');

/**
 * Parse an expression. Returns a node tree, which can be evaluated by
 * invoking node.eval();
 *
 * Syntax:
 *
 *     parse(expr)
 *     parse(expr, options)
 *     parse([expr1, expr2, expr3, ...])
 *     parse([expr1, expr2, expr3, ...], options)
 *
 * Example:
 *
 *     var node = parse('sqrt(3^2 + 4^2)');
 *     node.compile(math).eval(); // 5
 *
 *     var scope = {a:3, b:4}
 *     var node = parse('a * b'); // 12
 *     var code = node.compile(math);
 *     code.eval(scope); // 12
 *     scope.a = 5;
 *     code.eval(scope); // 20
 *
 *     var nodes = math.parse(['a = 3', 'b = 4', 'a * b']);
 *     nodes[2].compile(math).eval(); // 12
 *
 * @param {String | String[] | Matrix} expr
 * @param {{nodes: Object<String, Node>}} [options]  Available options:
 *                                                   - `nodes` a set of custom nodes
 * @return {Node | Node[]} node
 * @throws {Error}
 */
function parse (expr, options) {
  if (arguments.length != 1 && arguments.length != 2) {
    throw new ArgumentsError('parse', arguments.length, 1, 2);
  }

  // pass extra nodes
  extra_nodes = (options && options.nodes) ? options.nodes : {};

  if (isString(expr)) {
    // parse a single expression
    expression = expr;
    return parseStart();
  }
  else if (isArray(expr) || expr instanceof Matrix) {
    // parse an array or matrix with expressions
    return collection.deepMap(expr, function (elem) {
      if (!isString(elem)) throw new TypeError('String expected');

      expression = elem;
      return parseStart();
    });
  }
  else {
    // oops
    throw new TypeError('String or matrix expected');
  }
}

// token types enumeration
var TOKENTYPE = {
  NULL : 0,
  DELIMITER : 1,
  NUMBER : 2,
  SYMBOL : 3,
  UNKNOWN : 4
};

// map with all delimiters
var DELIMITERS = {
  ',': true,
  '(': true,
  ')': true,
  '[': true,
  ']': true,
  '\"': true,
  '\n': true,
  ';': true,

  '+': true,
  '-': true,
  '*': true,
  '.*': true,
  '/': true,
  './': true,
  '%': true,
  '^': true,
  '.^': true,
  '!': true,
  '\'': true,
  '=': true,
  ':': true,
  '?': true,

  '==': true,
  '!=': true,
  '<': true,
  '>': true,
  '<=': true,
  '>=': true
};

// map with all named delimiters
var NAMED_DELIMITERS = {
  'mod': true,
  'to': true,
  'in': true
};

var extra_nodes = {};             // current extra nodes
var expression = '';              // current expression
var index = 0;                    // current index in expr
var c = '';                       // current token character in expr
var token = '';                   // current token
var token_type = TOKENTYPE.NULL;  // type of the token

/**
 * Get the first character from the expression.
 * The character is stored into the char c. If the end of the expression is
 * reached, the function puts an empty string in c.
 * @private
 */
function first() {
  index = 0;
  c = expression.charAt(0);
}

/**
 * Get the next character from the expression.
 * The character is stored into the char c. If the end of the expression is
 * reached, the function puts an empty string in c.
 * @private
 */
function next() {
  index++;
  c = expression.charAt(index);
}

/**
 * Preview the next character from the expression.
 * @return {String} cNext
 * @private
 */
function nextPreview() {
  return expression.charAt(index + 1);
}

/**
 * Get next token in the current string expr.
 * The token and token type are available as token and token_type
 * @private
 */
function getToken() {
  token_type = TOKENTYPE.NULL;
  token = '';

  // skip over whitespaces
  while (c == ' ' || c == '\t') {  // space, tab
    // TODO: also take '\r' carriage return as newline? Or does that give problems on mac?
    next();
  }

  // skip comment
  if (c == '#') {
    while (c != '\n' && c != '') {
      next();
    }
  }

  // check for end of expression
  if (c == '') {
    // token is still empty
    token_type = TOKENTYPE.DELIMITER;
    return;
  }

  // check for delimiters consisting of 2 characters
  var c2 = c + nextPreview();
  if (c2.length == 2 && DELIMITERS[c2]) {
    token_type = TOKENTYPE.DELIMITER;
    token = c2;
    next();
    next();
    return;
  }

  // check for delimiters consisting of 1 character
  if (DELIMITERS[c]) {
    token_type = TOKENTYPE.DELIMITER;
    token = c;
    next();
    return;
  }

  // check for a number
  if (isDigitDot(c)) {
    token_type = TOKENTYPE.NUMBER;

    // get number, can have a single dot
    if (c == '.') {
      token += c;
      next();

      if (!isDigit(c)) {
        // this is no legal number, it is just a dot
        token_type = TOKENTYPE.UNKNOWN;
      }
    }
    else {
      while (isDigit(c)) {
        token += c;
        next();
      }
      if (c == '.') {
        token += c;
        next();
      }
    }
    while (isDigit(c)) {
      token += c;
      next();
    }

    // check for exponential notation like "2.3e-4" or "1.23e50"
    if (c == 'E' || c == 'e') {
      token += c;
      next();

      if (c == '+' || c == '-') {
        token += c;
        next();
      }

      // Scientific notation MUST be followed by an exponent
      if (!isDigit(c)) {
        // this is no legal number, exponent is missing.
        token_type = TOKENTYPE.UNKNOWN;
      }

      while (isDigit(c)) {
        token += c;
        next();
      }
    }

    return;
  }

  // check for variables, functions, named operators
  if (isAlpha(c)) {
    while (isAlpha(c) || isDigit(c)) {
      token += c;
      next();
    }

    if (NAMED_DELIMITERS[token]) {
      token_type = TOKENTYPE.DELIMITER;
    }
    else {
      token_type = TOKENTYPE.SYMBOL;
    }

    return;
  }

  // something unknown is found, wrong characters -> a syntax error
  token_type = TOKENTYPE.UNKNOWN;
  while (c != '') {
    token += c;
    next();
  }
  throw createSyntaxError('Syntax error in part "' + token + '"');
}

/**
 * Skip newline tokens
 */
function skipNewlines () {
  while (token == '\n') {
    getToken();
  }
}

/**
 * checks if the given char c is a letter (upper or lower case)
 * or underscore
 * @param {String} c   a string with one character
 * @return {Boolean}
 * @private
 */
function isAlpha (c) {
  return ((c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      c == '_');
}

/**
 * checks if the given char c is a digit or dot
 * @param {String} c   a string with one character
 * @return {Boolean}
 * @private
 */
function isDigitDot (c) {
  return ((c >= '0' && c <= '9') ||
      c == '.');
}

/**
 * checks if the given char c is a digit
 * @param {String} c   a string with one character
 * @return {Boolean}
 * @private
 */
function isDigit (c) {
  return ((c >= '0' && c <= '9'));
}

/**
 * Start of the parse levels below, in order of precedence
 * @return {Node} node
 * @private
 */
function parseStart () {
  // get the first character in expression
  first();

  getToken();

  var node = parseBlock();

  // check for garbage at the end of the expression
  // an expression ends with a empty character '' and token_type DELIMITER
  if (token != '') {
    if (token_type == TOKENTYPE.DELIMITER) {
      // user entered a not existing operator like "//"

      // TODO: give hints for aliases, for example with "<>" give as hint " did you mean != ?"
      throw createError('Unexpected operator ' + token);
    }
    else {
      throw createSyntaxError('Unexpected part "' + token + '"');
    }
  }

  return node;
}

/**
 * Parse a block with expressions. Expressions can be separated by a newline
 * character '\n', or by a semicolon ';'. In case of a semicolon, no output
 * of the preceding line is returned.
 * @return {Node} node
 * @private
 */
function parseBlock () {
  var node, block, visible;

  if (token == '') {
    // empty expression
    return new ConstantNode('undefined', 'undefined');
  }

  if (token != '\n' && token != ';') {
    node = parseFunctionAssignment();
  }

  while (token == '\n' || token == ';') {
    if (!block) {
      // initialize the block
      block = new BlockNode();
      if (node) {
        visible = (token != ';');
        block.add(node, visible);
      }
    }

    getToken();
    if (token != '\n' && token != ';' && token != '') {
      node = parseFunctionAssignment();

      visible = (token != ';');
      block.add(node, visible);
    }
  }

  if (block) {
    return block;
  }

  return node;
}

/**
 * Parse a function assignment like "function f(a,b) = a*b"
 * @return {Node} node
 * @private
 */
function parseFunctionAssignment () {
  // TODO: function assignment using keyword 'function' is deprecated since version 0.18.0, cleanup some day
  if (token_type == TOKENTYPE.SYMBOL && token == 'function') {
    throw createSyntaxError('Deprecated keyword "function". ' +
        'Functions can now be assigned without it, like "f(x) = x^2".');
  }

  return parseAssignment();
}

/**
 * Assignment of a variable, can be a variable like "a=2.3" or a updating an
 * existing variable like "matrix(2,3:5)=[6,7,8]"
 * @return {Node} node
 * @private
 */
function parseAssignment () {
  var name, args, expr;

  var node = parseConditional();

  if (token == '=') {
    if (node instanceof SymbolNode) {
      // parse a variable assignment like 'a = 2/3'
      name = node.name;
      getToken();
      expr = parseAssignment();
      return new AssignmentNode(name, expr);
    }
    else if (node instanceof IndexNode) {
      // parse a matrix subset assignment like 'A[1,2] = 4'
      getToken();
      expr = parseAssignment();
      return new UpdateNode(node, expr);
    }
    else if (node instanceof ParamsNode) {
      // parse function assignment like 'f(x) = x^2'
      var valid = true;
      args = [];
      if (node.object instanceof SymbolNode) {
        name = node.object.name;
        node.params.forEach(function (param, index) {
          if (param instanceof SymbolNode) {
            args[index] = param.name;
          }
          else {
            valid = false;
          }
        });
      }
      else {
        valid = false;
      }

      if (valid) {
        getToken();
        expr = parseAssignment();
        return new FunctionNode(name, args, expr);
      }
    }

    throw createSyntaxError('Invalid left hand side of assignment operator =');
  }

  return node;
}

/**
 * conditional operation
 *
 *     condition ? truePart : falsePart
 *
 * Note: conditional operator is right-associative
 *
 * @return {Node} node
 * @private
 */
function parseConditional () {
  var node = parseRange();

  while (token == '?') {
    getToken();
    var condition = node;
    var trueExpr = parseConditions(); // Note: we don't do parseRange here

    if (token != ':') throw createSyntaxError('False part of conditional expression expected');
    getToken();

    var falseExpr = parseConditional();

    node = new ConditionalNode(condition, trueExpr, falseExpr);
  }

  return node;
}

/**
 * conditional operators and bitshift
 * @return {Node} node
 * @private
 */
/* TODO: implement bitwise conditions. put on right place for precedence
function parseBitwiseConditions () {
  var node = parseRange();

   var operators = {
   '&' : 'bitwiseand',
   '|' : 'bitwiseor',
   // todo: bitwise xor?
   '<<': 'bitshiftleft',
   '>>': 'bitshiftright'
   };
   while (token in operators) {
   var name = token;

   getToken();
   var params = [node, parseComparison()];
   node = new OperatorNode(name, fn, params);
   }

  return node;
}
*/

/**
 * parse range, "start:end", "start:step:end", ":", "start:", ":end", etc
 * @return {Node} node
 * @private
 */
function parseRange () {
  var node, params = [];

  if (token == ':') {
    // implicit start=1 (one-based)
    node = new ConstantNode('1', 'number');
  }
  else {
    // explicit start
    node = parseConditions();
  }

  if (token == ':') {
    params.push(node);

    // parse step and end
    while (token == ':') {
      getToken();
      if (token == ')' || token == ']' || token == ',' || token == '') {
        // implicit end
        params.push(new SymbolNode('end'));
      }
      else {
        // explicit end
        params.push(parseConditions());
      }
    }

    // swap step and end
    if (params.length == 3) {
      var step = params[2];
      params[2] = params[1];
      params[1] = step;
    }
    node = new RangeNode(params);
  }

  return node;
}

/**
 * conditions like and, or, in
 * @return {Node} node
 * @private
 */
function parseConditions () {
  var node, operators, name, fn, params;

  node = parseComparison();

  // TODO: precedence of And above Or?
  // TODO: implement a method for unit to number conversion
  operators = {
    'to' : 'to',
    'in' : 'to'   // alias of to
    /* TODO: implement conditions
     'and' : 'and',
     '&&' : 'and',
     'or': 'or',
     '||': 'or',
     'xor': 'xor'
     */
  };

  while (token in operators) {
    name = token;
    fn = operators[name];

    getToken();
    params = [node, parseComparison()];
    node = new OperatorNode(name, fn, params);
  }

  return node;
}

/**
 * comparison operators
 * @return {Node} node
 * @private
 */
function parseComparison () {
  var node, operators, name, fn, params;

  node = parseAddSubtract();

  operators = {
    '==': 'equal',
    '!=': 'unequal',
    '<': 'smaller',
    '>': 'larger',
    '<=': 'smallerEq',
    '>=': 'largerEq'
  };
  while (token in operators) {
    name = token;
    fn = operators[name];

    getToken();
    params = [node, parseAddSubtract()];
    node = new OperatorNode(name, fn, params);
  }

  return node;
}

/**
 * add or subtract
 * @return {Node} node
 * @private
 */
function parseAddSubtract ()  {
  var node, operators, name, fn, params;

  node = parseMultiplyDivide();

  operators = {
    '+': 'add',
    '-': 'subtract'
  };
  while (token in operators) {
    name = token;
    fn = operators[name];

    getToken();
    params = [node, parseMultiplyDivide()];
    node = new OperatorNode(name, fn, params);
  }

  return node;
}

/**
 * multiply, divide, modulus
 * @return {Node} node
 * @private
 */
function parseMultiplyDivide () {
  var node, operators, name, fn, params;

  node = parseUnary();

  operators = {
    '*': 'multiply',
    '.*': 'dotMultiply',
    '/': 'divide',
    './': 'dotDivide',
    '%': 'mod',
    'mod': 'mod'
  };

  if (token in operators) {
    while (token in operators) {
      name = token;
      fn = operators[name];

      getToken();
      params = [node, parseUnary()];
      node = new OperatorNode(name, fn, params);
    }
  }

  // parse implicit multiplication
  if ((token_type == TOKENTYPE.SYMBOL) ||
      (token == 'in' && (node instanceof ConstantNode)) ||
      (token_type == TOKENTYPE.NUMBER && !(node instanceof ConstantNode)) ||
      (token == '(' || token == '[')) {
    // symbol:      implicit multiplication like '2a', '(2+3)a', 'a b'
    // number:      implicit multiplication like '(2+3)2'
    //              Note: we don't allow implicit multiplication between numbers,
    //              like '2 3'. I'm not sure whether that is a good idea.
    // parenthesis: implicit multiplication like '2(3+4)', '(3+4)(1+2)', '2[1,2,3]'
    node = new OperatorNode('*', 'multiply', [node, parseMultiplyDivide()]);
  }

  return node;
}

/**
 * Unary plus and minus
 * @return {Node} node
 * @private
 */
function parseUnary () {
  var name, fn, params;

  if (token == '-' || token == '+') {
    name = token;
    fn = name == '+' ? 'unaryPlus' : 'unaryMinus';
    getToken();
    params = [parseUnary()];

    return new OperatorNode(name, fn, params);
  }

  return parsePow();
}

/**
 * power
 * Note: power operator is right associative
 * @return {Node} node
 * @private
 */
function parsePow () {
  var node, name, fn, params;

  node = parseLeftHandOperators();

  if (token == '^' || token == '.^') {
    name = token;
    fn = (name == '^') ? 'pow' : 'dotPow';

    getToken();
    params = [node, parseUnary()]; // Go back to unary, we can have '2^-3'
    node = new OperatorNode(name, fn, params);
  }

  return node;
}

/**
 * Left hand operators: factorial x!, transpose x'
 * @return {Node} node
 * @private
 */
function parseLeftHandOperators ()  {
  var node, operators, name, fn, params;

  node = parseCustomNodes();

  operators = {
    '!': 'factorial',
    '\'': 'transpose'
  };

  while (token in operators) {
    name = token;
    fn = operators[name];

    getToken();
    params = [node];

    node = new OperatorNode(name, fn, params);
  }

  return node;
}

/**
 * Parse a custom node handler. A node handler can be used to process
 * nodes in a custom way, for example for handling a plot.
 *
 * A handler must be passed as second argument of the parse function.
 * - must extend math.expression.node.Node
 * - must contain a function _compile(defs: Object) : String
 * - must contain a function find(filter: Object) : Node[]
 * - must contain a function toString() : String
 * - the constructor is called with a single argument containing all parameters
 *
 * For example:
 *
 *     nodes = {
 *       'plot': PlotHandler
 *     };
 *
 * The constructor of the handler is called as:
 *
 *     node = new PlotHandler(params);
 *
 * The handler will be invoked when evaluating an expression like:
 *
 *     node = math.parse('plot(sin(x), x)', nodes);
 *
 * @return {Node} node
 * @private
 */
function parseCustomNodes () {
  var params = [], handler;

  if (token_type == TOKENTYPE.SYMBOL && extra_nodes[token]) {
    handler = extra_nodes[token];

    getToken();

    // parse parameters
    if (token == '(') {
      params = [];

      getToken();

      if (token != ')') {
        params.push(parseConditional());

        // parse a list with parameters
        while (token == ',') {
          getToken();

          params.push(parseConditional());
        }
      }

      if (token != ')') {
        throw createSyntaxError('Parenthesis ) expected');
      }
      getToken();
    }

    // create a new node handler
    //noinspection JSValidateTypes
    return new handler(params);
  }

  return parseSymbol();
}

/**
 * parse symbols: functions, variables, constants, units
 * @return {Node} node
 * @private
 */
function parseSymbol () {
  var node, name;

  if (token_type == TOKENTYPE.SYMBOL ||
      (token_type == TOKENTYPE.DELIMITER && token in NAMED_DELIMITERS)) {
    name = token;

    getToken();

    // create a symbol
    node = new SymbolNode(name);

    // parse function parameters and matrix index
    node = parseParams(node);
    node = parseIndex(node);
    return node;
  }

  return parseString();
}

/**
 * parse parameters, a function call like fn(a, b, c)
 * @param {Node} node    Node on which to apply the parameters. If there
 *                       are no parameters in the expression, the node
 *                       itself is returned
 * @return {Node} node
 * @private
 */
function parseParams (node) {
  var params;

  if (token == '(') {
    params = [];

    getToken();

    if (token != ')') {
      params.push(parseConditional());

      // parse a list with parameters
      while (token == ',') {
        getToken();
        params.push(parseConditional());
      }
    }

    if (token != ')') {
      throw createSyntaxError('Parenthesis ) expected');
    }
    getToken();

    node = new ParamsNode(node, params);
  }

  return node;
}

/**
 * parse index parameters, enclosed in square brackets [...], for example A[2,3]
 * @param {Node} node    Node on which to apply the parameters. If there
 *                       are no parameters in the expression, the node
 *                       itself is returned
 * @return {Node} node
 * @private
 */
function parseIndex (node) {
  var params;

  while (token == '[') {
    params = [];

    getToken();

    if (token != ']') {
      params.push(parseConditional());

      // parse a list with parameters
      while (token == ',') {
        getToken();
        params.push(parseConditional());
      }
    }

    if (token != ']') {
      throw createSyntaxError('Parenthesis ] expected');
    }
    getToken();

    node = new IndexNode(node, params);
  }

  return node;
}

/**
 * parse a string.
 * A string is enclosed by double quotes
 * @return {Node} node
 * @private
 */
function parseString () {
  var node, str, tPrev;

  if (token == '"') {
    // string "..."
    str = '';
    tPrev = '';
    while (c != '' && (c != '\"' || tPrev == '\\')) { // also handle escape character
      str += c;
      tPrev = c;
      next();
    }

    getToken();
    if (token != '"') {
      throw createSyntaxError('End of string " expected');
    }
    getToken();

    // create constant
    node = new ConstantNode(str, 'string');

    // parse index parameters
    node = parseIndex(node);

    return node;
  }

  return parseMatrix();
}

/**
 * parse the matrix
 * @return {Node} node
 * @private
 */
function parseMatrix () {
  var array, params, rows, cols;

  if (token == '[') {
    // matrix [...]
    getToken();
    skipNewlines();

    if (token != ']') {
      // this is a non-empty matrix
      var row = parseRow();

      if (token == ';') {
        // 2 dimensional array
        rows = 1;
        params = [row];

        // the rows of the matrix are separated by dot-comma's
        while (token == ';') {
          getToken();
          skipNewlines();

          params[rows] = parseRow();
          rows++;

          skipNewlines();
        }

        if (token != ']') {
          throw createSyntaxError('End of matrix ] expected');
        }
        getToken();

        // check if the number of columns matches in all rows
        cols = params[0].nodes.length;
        for (var r = 1; r < rows; r++) {
          if (params[r].nodes.length != cols) {
            throw createError('Column dimensions mismatch ' +
                '(' + params[r].nodes.length + ' != ' + cols + ')');
          }
        }

        array = new ArrayNode(params);
      }
      else {
        // 1 dimensional vector
        if (token != ']') {
          throw createSyntaxError('End of matrix ] expected');
        }
        getToken();

        array = row;
      }
    }
    else {
      // this is an empty matrix "[ ]"
      getToken();
      array = new ArrayNode([]);
    }

    return array;
  }

  return parseNumber();
}

/**
 * Parse a single comma-separated row from a matrix, like 'a, b, c'
 * @return {ArrayNode} node
 */
function parseRow () {
  var params = [parseAssignment()];
  var len = 1;

  while (token == ',') {
    getToken();
    skipNewlines();

    // parse expression
    params[len] = parseAssignment();
    len++;

    skipNewlines();
  }

  return new ArrayNode(params);
}

/**
 * parse a number
 * @return {Node} node
 * @private
 */
function parseNumber () {
  var node, complex, number;

  if (token_type == TOKENTYPE.NUMBER) {
    // this is a number
    number = token;
    getToken();

    /*
    if (token == 'i' || token == 'I') {
      // create a complex number
      getToken();
      node = new ConstantNode(number, 'complex');
    }
    else {
      // a number
      node = new ConstantNode(number, 'number');
    }
    */
    node = new ConstantNode(number, 'number');


    return node;
  }

  return parseParentheses();
}

/**
 * parentheses
 * @return {Node} node
 * @private
 */
function parseParentheses () {
  var node;

  // check if it is a parenthesized expression
  if (token == '(') {
    // parentheses (...)
    getToken();
    node = parseAssignment(); // start again

    if (token != ')') {
      throw createSyntaxError('Parenthesis ) expected');
    }
    getToken();

    return node;
  }

  return parseEnd();
}

/**
 * Evaluated when the expression is not yet ended but expected to end
 * @return {Node} res
 * @private
 */
function parseEnd () {
  if (token == '') {
    // syntax error or unexpected end of expression
    throw createSyntaxError('Unexpected end of expression');
  } else {
    throw createSyntaxError('Value expected');
  }
}

/**
 * Shortcut for getting the current row value (one based)
 * Returns the line of the currently handled expression
 * @private
 */
/* TODO: implement keeping track on the row number
function row () {
  return null;
}
*/

/**
 * Shortcut for getting the current col value (one based)
 * Returns the column (position) where the last token starts
 * @private
 */
function col () {
  return index - token.length + 1;
}

/**
 * Create an error
 * @param {String} message
 * @return {SyntaxError} instantiated error
 * @private
 */
function createSyntaxError (message) {
  var c = col();
  var error = new SyntaxError(message + ' (char ' + c + ')');
  error['char'] = c;

  return error;
}

/**
 * Create an error
 * @param {String} message
 * @return {Error} instantiated error
 * @private
 */
function createError (message) {
  var c = col();
  var error = new Error(message + ' (char ' + c + ')');
  error['char'] = c;

  return error;
}

module.exports = parse;
