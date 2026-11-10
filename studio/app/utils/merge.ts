export function merge(target: any, source: any) {
  Object.keys(source).forEach(function (key) {
    // 跳过原型链污染攻击向量
    if (key === "__proto__" || key === "constructor") return;

    if (
      source.hasOwnProperty(key) &&
      source[key] &&
      typeof source[key] === "object"
    ) {
      merge((target[key] = target[key] || {}), source[key]);
      return;
    }
    target[key] = source[key];
  });
}