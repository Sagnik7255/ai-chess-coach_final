const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const gameSchema = new mongoose.Schema({
  name: String,
  email: {
    type: String,
    unique: true
  },
  password: String
});

// ✅ HASH PASSWORD (ONLY ONCE)
gameSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ✅ COMPARE PASSWORD
gameSchema.methods.comparePassword = async function (inputPassword) {
  return await bcrypt.compare(inputPassword, this.password);
};

module.exports = mongoose.model("Game", gameSchema);