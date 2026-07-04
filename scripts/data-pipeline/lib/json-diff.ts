/**
 * Recursive JSON diff utility (ported from py_script/json_diff.py).
 */

export interface JsonDiffReporter {
  valDiff: (val1: unknown, val2: unknown, path: string) => void;
  lenDiff: (val1: unknown[], val2: unknown[], path: string) => void;
  typeDiff: (type1: string, type2: string, path: string) => void;
  pathDiff: (
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    key: string,
    path: string,
    side: boolean,
  ) => void;
  getKey: (path: string) => string;
}

function shorten(val: string): string {
  return val.length > 100 ? val.slice(0, 100) + '...' : val;
}

function isBasicType(val: unknown): boolean {
  const t = typeof val;
  return t === 'number' || t === 'string' || t === 'boolean';
}

let inputAlive = true;

function customInput(_path: string): string {
  if (!inputAlive) return '';
  try {
    // Interactive stdin not supported in non-TTY batch runs; return empty key.
    return '';
  } catch {
    inputAlive = false;
    return '';
  }
}

function printValDiff(val1: unknown, val2: unknown, path: string): void {
  console.log(`${path}: Value difference`);
  console.log(`    Left:  ${shorten(String(val1))}`);
  console.log(`    Right: ${shorten(String(val2))}`);
}

function printLenDiff(val1: unknown[], val2: unknown[], path: string): void {
  console.log(`${path}: Length difference`);
  console.log(`    Left  (length ${val1.length}): ${shorten(String(val1))}`);
  console.log(`    Right (length ${val2.length}): ${shorten(String(val2))}`);
}

function printTypeDiff(type1: string, type2: string, path: string): void {
  console.log(`${path}: Type difference [${type1} != ${type2}]`);
}

function printPathDiff(
  _1: Record<string, unknown>,
  _2: Record<string, unknown>,
  key: string,
  path: string,
  side: boolean,
): void {
  if (side) {
    console.log(`${path}.${key}: Contained in right but not left`);
    console.log(`    Value: ${shorten(String(_2[key]))}`);
  } else {
    console.log(`${path}.${key}: Contained in left but not right`);
    console.log(`    Value: ${shorten(String(_1[key]))}`);
  }
}

export const JSON_DIFF_PRINTER: JsonDiffReporter = {
  valDiff: printValDiff,
  lenDiff: printLenDiff,
  typeDiff: printTypeDiff,
  pathDiff: printPathDiff,
  getKey: customInput,
};

export const JSON_DIFF_PRINTER_KEYLESS: JsonDiffReporter = {
  ...JSON_DIFF_PRINTER,
  getKey: () => '',
};

function throwValDiff(val1: unknown, val2: unknown, path: string): never {
  throw new Error(
    `${path}: Value difference\n    Left:  ${shorten(String(val1))}\n    Right: ${shorten(String(val2))}`,
  );
}

function throwLenDiff(val1: unknown[], val2: unknown[], path: string): never {
  throw new Error(
    `${path}: Length difference\n    Left  (length ${val1.length}): ${shorten(String(val1))}\n    Right (length ${val2.length}): ${shorten(String(val2))}`,
  );
}

function throwTypeDiff(type1: string, type2: string, path: string): never {
  throw new TypeError(`${path}: Type difference [${type1} != ${type2}]`);
}

function throwPathDiff(
  _1: Record<string, unknown>,
  _2: Record<string, unknown>,
  key: string,
  path: string,
  side: boolean,
): never {
  const msg = side
    ? `${path}.${key}: Contained in right but not left\n    Value: ${shorten(String(_2[key]))}`
    : `${path}.${key}: Contained in left but not right\n    Value: ${shorten(String(_1[key]))}`;
  throw new Error(msg);
}

export function getTestDiffHandler(
  getKey: (path: string) => string,
): JsonDiffReporter {
  return {
    valDiff: throwValDiff,
    lenDiff: throwLenDiff,
    typeDiff: throwTypeDiff,
    pathDiff: throwPathDiff,
    getKey,
  };
}

function listDiff(
  reporter: JsonDiffReporter,
  list1: unknown[],
  list2: unknown[],
  path: string,
): boolean {
  process.stderr.write(`Encountered object list ${path}, enter match key: `);
  const key = reporter.getKey(path);
  if (key === '') {
    if (JSON.stringify(list1) !== JSON.stringify(list2)) {
      reporter.valDiff(list1, list2, path);
      return true;
    }
    return false;
  }
  const left = Object.fromEntries(
    (list1 as Record<string, unknown>[]).map((x) => [x[key], x]),
  );
  const right = Object.fromEntries(
    (list2 as Record<string, unknown>[]).map((x) => [x[key], x]),
  );
  return objectDiff(reporter, left, right, path);
}

function objectDiff(
  reporter: JsonDiffReporter,
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>,
  path: string,
): boolean {
  let ret = false;
  for (const [k, val] of Object.entries(obj1)) {
    if (k in obj2) {
      const obj = obj2[k];
      const type1 = typeof val;
      const type2 = typeof obj;
      if (type1 !== type2) {
        reporter.typeDiff(type1, type2, `${path}.${k}`);
        ret = true;
      } else if (Array.isArray(val)) {
        const arr = obj as unknown[];
        if (val.length !== arr.length) {
          reporter.lenDiff(val, arr, `${path}.${k}`);
          ret = true;
        } else if (val.length === 0) {
          continue;
        } else if (isBasicType(val[0])) {
          if (JSON.stringify(val) !== JSON.stringify(arr)) {
            reporter.valDiff(val, arr, `${path}.${k}`);
            ret = true;
          }
          continue;
        }
        ret = listDiff(reporter, val, arr, `${path}.${k}`) || ret;
      } else if (isBasicType(val) || val === null || obj === null) {
        if (val !== obj) {
          reporter.valDiff(val, obj, `${path}.${k}`);
          ret = true;
        }
      } else {
        ret =
          objectDiff(
            reporter,
            val as Record<string, unknown>,
            obj as Record<string, unknown>,
            `${path}.${k}`,
          ) || ret;
      }
      continue;
    }
    reporter.pathDiff(obj1, obj2, k, path, false);
    ret = true;
  }
  for (const k of Object.keys(obj2)) {
    if (!(k in obj1)) {
      reporter.pathDiff(obj1, obj2, k, path, true);
      ret = true;
    }
  }
  return ret;
}

export function jsonDiff(
  json1: unknown,
  json2: unknown,
  reporter: JsonDiffReporter = JSON_DIFF_PRINTER_KEYLESS,
): boolean {
  if (Array.isArray(json1) && Array.isArray(json2)) {
    return listDiff(reporter, json1, json2, '$');
  }
  return objectDiff(
    reporter,
    json1 as Record<string, unknown>,
    json2 as Record<string, unknown>,
    '$',
  );
}
