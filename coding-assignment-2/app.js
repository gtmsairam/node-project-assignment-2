const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;
let activeUser;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:30000");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
  }
};

initializeDBAndServer();

// register a user
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const userQuery = `
    SELECT * FROM user WHERE username = '${username}';
  `;
  const dbUser = await db.get(userQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length >= 6) {
      try {
        const createUserQuery = `
       INSERT INTO 
        user(name, username, password, gender)
        VALUES
         ('${name}', '${username}', '${hashedPassword}', '${gender}')
      `;
        await db.run(createUserQuery);
        response.send("User created successfully");
      } catch (e) {
        console.log(`DB Error: ${e.message}`);
      }
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  }
});

// authentication user
const authenticate = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        activeUser = payload;
        next();
      }
    });
  }
};

// login a user
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `
     SELECT * FROM user WHERE username = '${username}';
    `;
  const dbUser = await db.get(getUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isMatchedPassword = await bcrypt.compare(password, dbUser.password);
    if (!isMatchedPassword) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = { userId: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
      console.log(jwtToken);
    }
  }
});

// user based latest 4 tweets
app.get("/user/tweets/feed/", authenticate, async (request, response) => {
  const dbQuery = `
   SELECT name AS username,
   tweet ,
   date_time AS dateTime
   FROM tweet INNER JOIN user ON 
   tweet.user_id = user.user_id
   GROUP BY tweet_id 
   HAVING tweet.user_id IN (
       SELECT follower_user_id FROM follower 
       WHERE following_user_id = ${activeUser.userId}
   )
   ORDER BY 
    strftime("%Y%, %m%, %d%, %H%, %m%, %s%", date_time) DESC
   LIMIT 4  
  `;
  const users = await db.all(dbQuery);
  response.send(users);
});

// user following
app.get("/user/following/", authenticate, async (request, response) => {
  try {
    const dbQuery = `
     SELECT 
      name 
      FROM 
      user 
      WHERE user_id IN(
          SELECT following_user_id FROM follower 
          WHERE follower_user_id = ${activeUser.userId}
      )
    `;
    const followedUsers = await db.all(dbQuery);
    response.send(followedUsers);
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
  }
});

// user followers
app.get("/user/followers", authenticate, async (request, response) => {
  const dbQuery = `
      SELECT name FROM user 
      WHERE user_id IN(
          SELECT follower_user_id FROM follower 
          WHERE following_user_id = ${activeUser.userId}
      )
    `;
  const followers = await db.all(dbQuery);
  response.send(followers);
});

// user followers tweet details
app.get("/tweet/:tweetId/", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const dbQuery = `
   SELECT tweet,
   COUNT(DISTINCT like.like_id) AS likes,
   COUNT(DISTINCT reply.reply_id) AS replies ,
   tweet.date_time AS dateTime
   FROM (tweet INNER JOIN like ON 
   tweet.user_id = like.user_id) AS T INNER JOIN reply ON 
   like.user_id = T.user_id
   WHERE tweet.tweet_id = ${tweetId}
   GROUP BY tweet.user_id 
   HAVING tweet.user_id IN(
       SELECT follower_user_id FROM follower 
       WHERE following_user_id = ${activeUser.userId}
   )
   `;
  const dbResponse = await db.get(dbQuery);
  console.log(dbResponse);
  if (dbResponse === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(dbResponse);
  }
});

// followers list with names
app.get("/tweets/:tweetId/likes/", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const dbQuery = `
   SELECT name
   FROM like INNER JOIN user ON
   user.user_id = like.user_id 
   WHERE tweet_id = ${tweetId}
   GROUP BY like.user_id 
   HAVING like.user_id IN(
       SELECT follower_user_id FROM follower 
       WHERE following_user_id = ${activeUser.userId}
   )
   
   `;
  const dbResponse = await db.all(dbQuery);

  const array = [];
  const nameObject = {
    likes: array,
  };
  function convertIntoArray(object) {
    array.push(object.name);
  }
  dbResponse.map((eachItem) => convertIntoArray(eachItem));

  if (nameObject.likes.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(nameObject);
  }
});

// checking
app.get(
  "/tweets/:tweetId/replies/",
  authenticate,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery = `
  SELECT name, reply, reply.user_id FROM reply INNER JOIN user ON
  reply.user_id = user.user_id
  WHERE tweet_id = ${tweetId}
  GROUP BY reply.reply_id 
  HAVING reply.user_id IN(
      SELECT follower_user_id from follower 
      WHERE following_user_id = ${activeUser.userId}
   ) 
  `;
    const dbResponse = await db.all(dbQuery);

    let array = [];
    const replyObject = {
      replies: array,
    };
    function convertIntoArray(object) {
      array.push([{ name: object.name, reply: object.reply }]);
    }
    dbResponse.map((eachItem) => convertIntoArray(eachItem));

    if (replyObject.replies.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send(replyObject);
    }
  }
);

// get login user all tweets
app.get("/users/tweets/", authenticate, async (request, response) => {
  const dbQuery = `
     SELECT 
      tweet.tweet, 
      count(DISTINCT like.like_id) AS likes,
      COUNT(DISTINCT reply.reply_id) AS replies,
      tweet.date_time AS dateTIme
     FROM (tweet INNER JOIN like ON 
     tweet.tweet_id = like.tweet_id) AS T 
     INNER JOIN reply ON 
     reply.user_id = T.user_id
     WHERE tweet.user_id = ${activeUser.userId}
     GROUP BY 
     tweet.tweet_id
    `;
  const dbResponse = await db.all(dbQuery);
  response.send(dbResponse);
});

app.post("/user/tweets/", authenticate, async (request, response) => {
  const { tweet } = request.body;
  try {
    const dateTime = new Date();
    const query = `
   INSERT INTO 
    tweet (tweet, user_id, date_time)
     VALUES
        ('${tweet}', ${activeUser.userId}, '${dateTime}')
  `;
    await db.run(query);
    response.send("Created a Tweet");
  } catch (e) {
    console.log(`${e.message}`);
  }
});

// delete his tweet

app.delete("/tweets/:tweetId/", authenticate, async (request, response) => {
  const { tweetId } = request.params;
  const query = `
     SELECT user_id FROM tweet 
     WHERE tweet_id = ${tweetId}
    `;
  const sameUser = await db.get(query);

  if (sameUser.user_id === activeUser.userId) {
    const query = `
      DELETE FROM tweet 
      WHERE tweet_id = ${tweetId}
    `;
    await db.run(query);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get("/check/", authenticate, async (req, res) => {
  try {
    const dbQuery = `
   SELECT name AS username,
   tweet ,
   date_time AS dateTime
   FROM tweet INNER JOIN user ON 
   tweet.user_id = user.user_id
   GROUP BY tweet_id 
   HAVING tweet.user_id IN (
       SELECT follower_user_id FROM follower 
       WHERE following_user_id = ${activeUser.userId}
   )
   
   `;

    const ans = await db.all(dbQuery);
    res.send(ans);
  } catch (e) {
    console.log(e);
  }
});

module.exports = app;
