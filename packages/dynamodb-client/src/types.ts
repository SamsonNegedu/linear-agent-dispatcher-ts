export interface Key {
  [key: string]: string;
}

export interface FormattedUpdate {
  updateExpression: string;
  updateValues: {
    [key: string]: unknown;
  };
  attributeNames: {
    [key: string]: string;
  };
}
