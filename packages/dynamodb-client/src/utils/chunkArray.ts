export const chunkArray = <T>(arr: T[], size = 100): T[][] => {
  const accumulator: T[][] = [];
  return arr.reduce((acc, _, i) => {
    if (i % size === 0) {
      acc.push(arr.slice(i, i + size));
    }
    return acc;
  }, accumulator);
};
