function padNumber(number) {
  return number < 10 ? `0${number}` : `${number}`;
}

function formatTime(date) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hour = padNumber(date.getHours());
  const minute = padNumber(date.getMinutes());
  const second = padNumber(date.getSeconds());

  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

function pickRandom(items) {
  if (!items.length) {
    return null;
  }

  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

module.exports = {
  formatTime,
  pickRandom
};
