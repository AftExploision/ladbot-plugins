module.exports = {
  'name': 'concat',
  'category': 'Matrix',
  'syntax': [
    'concat(A, B, C, ...)',
    'concat(A, B, C, ..., dim)'
  ],
  'description': 'Concatenate matrices. By default, the matrices are concatenated by the first dimension. The dimension on which to concatenate can be provided as last argument.',
  'examples': [
    'A = [1, 2; 5, 6]',
    'B = [3, 4; 7, 8]',
    'concat(A, B)',
    '[A, B]',
    'concat(A, B, 1)',
    '[A; B]'
  ],
  'seealso': [
    'det', 'diag', 'eye', 'inv', 'ones', 'range', 'size', 'squeeze', 'subset', 'transpose', 'zeros'
  ]
};
