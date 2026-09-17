export const delay = async (time) => {
  return new Promise(function (resolve) {
    setTimeout(resolve, time * 1000);
  });
};
