type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' };

const PRECEDENCE: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '%': 2,
  '^': 3,
};

const RIGHT_ASSOCIATIVE = new Set(['^']);

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const previous = tokens[tokens.length - 1];
    const unaryMinus =
      char === '-' &&
      (!previous || (previous.type === 'operator') || (previous.type === 'paren' && previous.value === '('));

    if (/\d|\./.test(char) || unaryMinus) {
      let value = unaryMinus ? '-' : '';
      index += unaryMinus ? 1 : 0;

      while (index < expression.length && /[\d.]/.test(expression[index])) {
        value += expression[index];
        index += 1;
      }

      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error('Invalid number');
      }

      tokens.push({ type: 'number', value: parsed });
      continue;
    }

    if ('+-*/%^'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index += 1;
      continue;
    }

    throw new Error('Unsupported character');
  }

  return tokens;
}

function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];

  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
      continue;
    }

    if (token.type === 'operator') {
      while (operators.length) {
        const top = operators[operators.length - 1];
        if (top.type !== 'operator') break;

        const shouldPop = RIGHT_ASSOCIATIVE.has(token.value)
          ? PRECEDENCE[token.value] < PRECEDENCE[top.value]
          : PRECEDENCE[token.value] <= PRECEDENCE[top.value];

        if (!shouldPop) break;
        output.push(operators.pop()!);
      }

      operators.push(token);
      continue;
    }

    if (token.value === '(') {
      operators.push(token);
      continue;
    }

    while (operators.length && operators[operators.length - 1].value !== '(') {
      output.push(operators.pop()!);
    }

    if (!operators.length) {
      throw new Error('Mismatched parentheses');
    }

    operators.pop();
  }

  while (operators.length) {
    const operator = operators.pop()!;
    if (operator.type === 'paren') {
      throw new Error('Mismatched parentheses');
    }

    output.push(operator);
  }

  return output;
}

function evaluateRpn(tokens: Token[]): number {
  const stack: number[] = [];

  for (const token of tokens) {
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }

    if (token.type !== 'operator') continue;

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      throw new Error('Invalid expression');
    }

    switch (token.value) {
      case '+':
        stack.push(left + right);
        break;
      case '-':
        stack.push(left - right);
        break;
      case '*':
        stack.push(left * right);
        break;
      case '/':
        stack.push(left / right);
        break;
      case '%':
        stack.push(left % right);
        break;
      case '^':
        stack.push(left ** right);
        break;
      default:
        throw new Error('Invalid operator');
    }
  }

  if (stack.length !== 1 || !Number.isFinite(stack[0])) {
    throw new Error('Invalid result');
  }

  return stack[0];
}

export function calculateExpression(expression: string): number {
  const tokens = tokenize(expression);
  if (!tokens.length) {
    throw new Error('Empty expression');
  }

  return evaluateRpn(toRpn(tokens));
}
