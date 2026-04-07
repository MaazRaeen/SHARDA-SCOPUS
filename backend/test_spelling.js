const normalizeSpelling = s => s.toLowerCase()
    .replace(/gg/g, 'g')
    .replace(/w/g, 'v')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/sh/g, 's')
    .replace(/y/g, 'i')
    .replace(/agrawal/g, 'agarwal')
    .replace(/aggarwal/g, 'agarwal');

console.log('agarwal ->', normalizeSpelling('agarwal'));
console.log('agrawal ->', normalizeSpelling('agrawal'));
console.log('Match?', normalizeSpelling('agarwal') === normalizeSpelling('agrawal'));
