import { FormattedUpdate } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbItem = any;

export const formatUpdateExpression = (values: DbItem): FormattedUpdate => {
  let updateExpression = 'set ';
  const updateValues: FormattedUpdate['updateValues'] = {};
  const attributeNames: FormattedUpdate['attributeNames'] = {};
  const alphabet = [...'abcdefghijklmnopqrstuvwxyz'];
  const updateEntries = Object.keys(values).length;
  if (updateEntries === 0 || updateEntries > alphabet.length) {
    return { updateExpression: '', updateValues: {}, attributeNames };
  }
  Object.keys(values).forEach((key, i) => {
    const index = alphabet[i];
    attributeNames[`#${index}`] = key;
    updateExpression += `#${index} = :${index},`;
    updateValues[`:${index}`] = values[key];
  });
  updateExpression = updateExpression.slice(0, -1);

  return { updateExpression, updateValues, attributeNames };
};
