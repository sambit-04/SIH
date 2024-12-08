let lastLoggedInEmail = null;
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const cors = require('cors');
// const imageSize = require('image-size');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const moment = require('moment');
const { ISODate } = require('mongodb');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const apikeys = require('./apikeys.json');
const SCOPE = ['https://www.googleapis.com/auth/drive'];
const { format, subDays } = require('date-fns');

const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const validator = require('validator');

let rollingScores = [0.7883594,0.7883594,0.7883594,0.7883594];

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://127.0.0.1:5500',
  credentials: true,
  methods: ['GET', 'POST','DELETE'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

mongoose.connect('mongodb://127.0.0.1:27017/sihDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Increase the limit for request payload size
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const filePath = 'temp/score.txt';

// Convert the array to JSON-formatted string
const jsonString = JSON.stringify(rollingScores, null, 2);

// Write the JSON string to the file
fs.writeFile(filePath, jsonString, 'utf8')
  .then(() => {
    console.log('File has been updated with the rollingScores array.');
  })
  .catch((error) => {
    console.error('Error writing to the file:', error);
  });


// Define a MongoDB schema for storing geotagged photos
const geotaggedPhotoSchema = new mongoose.Schema({
  image: {
    type: String,
    required: true,
  },
  latitude: {
    type: Number,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
  time: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  g_id: {
    type: String,
  },
  uploaded: {
    type:Boolean,
    required:true,
  },
  
});

const GeotaggedPhoto = mongoose.model('GeotaggedPhoto', geotaggedPhotoSchema);

const budgetItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
});

const BudgetItem = mongoose.model('BudgetItem', budgetItemSchema);

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  securityQuestion: String,
  securityAnswer: String,
});

const User = mongoose.model('User', UserSchema);

const alertSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
  },
  message: String,
});

const Alert = mongoose.model('Alert', alertSchema);


app.use(bodyParser.json());

// const rollingScoresSchema = new mongoose.Schema({

//   scores: {
//     type: [Number],
//     default: [],
//   },

// });

// const RollingScoresModel = mongoose.model('RollingScores', rollingScoresSchema);

function isStrongPassword(password) {
    return validator.isLength(password, { min: 8 }) && validator.matches(password, /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/);
}

app.post('/register', async (req, res) => {
  console.log(req.body);
  const email = req.body.email;
  const password=req.body.password;

  if (!validator.isEmail(email)) {
      return res.status(400).send({ error: 'Invalid Email ID' });
  }

  if (!isStrongPassword(password)) {
      return res.status(400).send({ error: 'Password is not strong enough' });
  }

  const existingUserByMobile = await User.findOne({mobile:req.body.mobile});
  if (existingUserByMobile) {
      return res.status(400).send({ error: 'Mobile number is already registered' });
  }

  const existingUserByEmail = await User.findOne({email: req.body.email});
  if (existingUserByEmail) {
      return res.status(400).send({ error: 'Email is already registered' });
  }

  try {
      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      const hashedAnswer = await bcrypt.hash(req.body.securityAnswer, 10);

      const user = new User({
          email: req.body.email,
          password: hashedPassword,
          mobile: req.body.mobile,
          securityQuestion: req.body.securityQuestion,
          securityAnswer: hashedAnswer
      });

      await user.save();
      res.status(201).send({ success: 'User registered' });
  } catch (err) {
      res.status(400).send({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  const email = req.body.email;

  if (!validator.isEmail(email)) {
      return res.status(400).send({ error: 'Invalid Email ID' });
  }

  try {
      const user = await User.findOne({ email: req.body.email });
      
      if (!user) {
          return res.status(400).send({ error: 'User not found' });
      }
      
      const isMatch = await bcrypt.compare(req.body.password, user.password);
      
      if (!isMatch) {
          return res.status(400).send({ error: 'Incorrect password' });
      }
      lastLoggedInEmail = user.email;
      res.send({ success: 'Logged in successfully' });
  } catch (err) {
      res.status(500).send({ error: 'Server error' });
  }
});

app.post('/reset-password', async (req, res) => {
  try {
      const user = await User.findOne({ email: req.body.email });

      if (!user) {
          return res.status(400).send({ message: 'User not found' });
      }

      if (!isStrongPassword(password)) {
          return res.status(400).send({ error: 'Password is not strong enough' });
      }

      console.log("req.body.answer:", req.body.answer);
console.log("user.securityAnswer:", user.securityAnswer);
      const isMatch = await bcrypt.compare(req.body.answer, user.securityAnswer);

      if (user.securityQuestion === req.body.question && isMatch) {
          const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
          user.password = hashedPassword;
          await user.save();
          res.send({ message: 'Password reset successfully!' });
      } else {
          res.status(400).send({ message: 'Incorrect security answer' });
      }

  } catch (error) {
      console.error(error);  
      res.status(500).send({ message: 'Server error' });
  }
});

app.get('/getBudgetItemsSum', async (req, res) => {
  try {
    // Use the MongoDB aggregation framework to calculate the sum for each category
    const result = await BudgetItem.aggregate([
      {
        $group: {
          _id: '$category', // Group by category
          totalAmount: { $sum: '$amount' }, // Calculate sum for each category
        },
      },
    ]);

    // Convert the result array to a key-value pair
    const sumByCategory = {};
    result.forEach(entry => {
      sumByCategory[entry._id] = entry.totalAmount;
    });

    // Send the key-value pair to the client
    res.status(200).json({ sumByCategory });
  } catch (error) {
    console.error('Error in getBudgetItemsSum route:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/addBudgetItem', async (req, res) => {
  const { name, amount, date, category } = req.body;

  try {
    const newBudgetItem = new BudgetItem({
      name,
      amount,
      date,
      category,
    });

    const savedBudgetItem = await newBudgetItem.save();
    const budgetItems = await BudgetItem.find();

    res.status(201).json({ budgetItems });
  } catch (error) {
    console.error('Error adding budget item:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/getBudgetItems', async (req, res) => {
  try {
    const budgetItems = await BudgetItem.find();
    res.json({ budgetItems });
  } catch (error) {
    console.error('Error fetching budget items:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

function processImageUpload() {
  try {
    const getTodayDate = () => {
      const today = new Date();
      return format(today, 'yyyy-MM-dd'); // Assuming you have a format function
    };

    const getYesterdayDate = () => {
      const yesterday = subDays(new Date(), 1);
      return format(yesterday, 'yyyy-MM-dd'); // Assuming you have a format function
    };

    const todayDate = getTodayDate();
    const yesterdayDate = getYesterdayDate();
    console.log(todayDate);
    console.log(yesterdayDate);

    const ftodayDate = new Date(todayDate + "T18:30:00.000Z");
    const fyesterdayDate = new Date(yesterdayDate + "T18:30:00.000Z");

    console.log(ftodayDate);
    console.log(fyesterdayDate);

    const photos = GeotaggedPhoto.find(
      {
        date: {
          $in: [ftodayDate, fyesterdayDate]
        }
      },
      { _id: 0, __v: 0 }
    );
    
      console.log(photos);
    // Check if photos array is not empty before accessing its elements
    if (photos && photos.length >= 2) {
      const todayFilePath = path.join(__dirname, 'temp', `imgToday.txt`);
      const yesterdayFilePath = path.join(__dirname, 'temp', `imgYest.txt`);

      console.log('Today\'s File Path:', todayFilePath);
      console.log('Yesterday\'s File Path:', yesterdayFilePath);
      console.log(photos[0].image);
      console.log(photos[1].image);
      fs.writeFileSync(todayFilePath, photos[0].image, 'utf-8');
      fs.writeFileSync(yesterdayFilePath, photos[1].image, 'utf-8');

      console.log('Image data appended to files.');

      const pythonProcess = spawn('python', ["python/compare.py", todayFilePath, yesterdayFilePath]);

      console.log('Python script executed.');
    } else {
      console.error('Not enough geotagged photos found for the specified date range.');
    }
  } catch (error) {
    console.error('Error in post-save immediate middleware:', error);
  }
}

// function processDelayedSave() {
//   try {
//     console.log('Processing Delayed Save:', doc.image);

//     // Read the contents of score.txt
//     const scoreFilePath = path.join(__dirname, 'temp', 'score.txt');
//     const scoreData = fs.readFileSync(scoreFilePath, 'utf-8');

//     // Parse the score data or perform any processing as needed
//     const parsedScore = parseFloat(scoreData);

//     // Add the parsed score to the rolling scores array
//     rollingScores.unshift(parsedScore);

//     // Ensure the array does not exceed the maximum size (10 in this case)
//     const MAX_ARRAY_SIZE = 10;
//     if (rollingScores.length > MAX_ARRAY_SIZE) {
//       rollingScores.pop();  // Remove the oldest element if the array is full
//     }

//     console.log('Rolling Scores:', rollingScores);
//     console.log('Delayed Save Processed.');
//   } catch (error) {
//     console.error('Error in post-save delayed middleware:', error);
//   }
// }

// geotaggedPhotoSchema.post('save', async function (doc) {
//   try {
//     // Schedule the execution of the delayed function after 1 minute (60,000 milliseconds)
//     setTimeout(async () => {
//       console.log('One minute has passed since the document was saved (Delayed):', doc.image);

//       // Read the contents of score.txt
//       const scoreFilePath = path.join(__dirname, 'temp', 'score.txt');
//       const scoreData = await fs.readFile(scoreFilePath, 'utf-8');

//       // Parse the score data or perform any processing as needed
//       const parsedScore = parseFloat(scoreData);

//       // Find or create the rolling scores document based on the user ID
//       let rollingScoresDoc = await RollingScoresModel.findOne({ userId: doc.userId });

//       if (!rollingScoresDoc) {
//         rollingScoresDoc = new RollingScoresModel({
//           userId: doc.userId,
//         });
//       }

//       // Add the parsed score to the rolling scores array
//       rollingScoresDoc.scores.unshift(parsedScore);

//       // Ensure the array does not exceed the maximum size
//       const MAX_ARRAY_SIZE = /* provide the maximum array size */;
//       if (rollingScoresDoc.scores.length > MAX_ARRAY_SIZE) {
//         rollingScoresDoc.scores.pop();  // Remove the oldest element if the array is full
//       }

//       // Save the updated rolling scores document to the database
//       await rollingScoresDoc.save();

//     }, 60000);
//   } catch (error) {
//     console.error('Error in post-save delayed middleware:', error);
//   }
// });

// setInterval(processUploadQueue, 100000);

// async function processUploadQueue() {
//   try {
//     const photos = await GeotaggedPhoto.find({ uploaded: false });

//     for (const photo of photos) {
      
//       const g_id = await uploadBasic(photo.image,req.body.date);

//       if (g_id) {
//         // Mark the image as uploaded in the local database
//         await GeotaggedPhoto.updateOne({uploaded:false},{$set:{uploaded:true}});
//       }
//     }
//   } catch (error) {
//     console.error('Error processing upload queue:', error);
//   }
// }

async function uploadBasic(geotaggedPhotoBase64) {
  const fs = require('fs');
  const { GoogleAuth } = require('google-auth-library');
  const { google } = require('googleapis');
  const path = require('path');
  const sharp = require('sharp');

  // Replace 'path/to/your/service-account-key.json' with the actual path to your service account JSON key file
  const auth = new GoogleAuth({
    keyFile: 'apikeys.json',
    scopes: 'https://www.googleapis.com/auth/drive',
  });

  try {
    // Get credentials and build service
    const authClient = await auth.getClient();
    const service = google.drive({ version: 'v3', auth: authClient });

    const requestBody = {
      name: 'img.jpg',
      fields: 'id',
      parents: ['1bwEhQFv9vjvDls2t8MHZR6RVRt0bVbKH'],
    };

      saveBase64AsImage(geotaggedPhotoBase64, 'upload');

      const media = {
        mimeType: 'image/jpeg',
        body: fs.createReadStream('upload.jpg'),
      };

      const file = await service.files.create({
        requestBody,
        media: media,
      });
      console.log('File Id:', file.data.id);
      return file.data.id;

      

  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  }
}

function saveBase64AsImage(base64String, filename) {
  
const fs = require('fs');
  // Remove the data URI prefix and split the base64 string

  const base64Data = base64String.replace(/^data:image\/jpeg;base64,/, '');
  console.log('base 64 encoded');

  // Convert the base64 data to a buffer
  const buffer = Buffer.from(base64Data, 'base64');

  // Save the buffer to a file with a .jpg extension
  fs.writeFileSync(`${filename}.jpg`, buffer, 'binary');

  console.log(`Image saved as ${filename}.jpg`);
}

app.post('/uploadGeotaggedPhoto', async (req, res) => {
  try {
    console.log('Received request for geotagged photo upload.');

    const geotaggedPhotoBase64 = req.body.geotaggedPhoto;
    const { latitude, longitude, time, date } = req.body;

    const parsedDate = new Date(date);

    console.log('Uploading file to Google Drive...');

    // let g_id;

    // try {
    //   g_id = await uploadBasic(geotaggedPhotoBase64, req.body.date);
    // } catch (uploadError) {
    //   console.error('Error uploading file to Google Drive:', uploadError);
    //   return res.status(500).json({ error: 'Error uploading file to Google Drive' });
    // }

    // if (!g_id) {
      console.error('Google Drive ID not returned');
      console.log('Creating new GeotaggedPhoto document...');
      const newGeotaggedPhoto = new GeotaggedPhoto({
        image: geotaggedPhotoBase64,
        latitude,
        longitude,
        time,
        date: parsedDate,
        uploaded:false,
      });

      await newGeotaggedPhoto.save();

      // Call processImageUpload after saving the geotagged photo document
      processImageUpload();

      return res.status(500).json({ error: 'Google Drive ID not returned' });
    // } else {
    //   console.log('Creating new GeotaggedPhoto document...');
    //   const newGeotaggedPhoto = new GeotaggedPhoto({
    //     image: geotaggedPhotoBase64,
    //     latitude,
    //     longitude,
    //     time,
    //     date: parsedDate,
    //     g_id,
    //     uploaded:true,
    //   });
      
    //   await newGeotaggedPhoto.save();
    // }

    // console.log('GeotaggedPhoto document saved to the database.');

    // processImageUpload();

    // res.status(201).json({ message: 'Geotagged photo uploaded successfully' });
  } catch (error) {
    console.error('Error in uploadGeotaggedPhoto route:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
app.get('/fetchGeotaggedPhotos', async (req, res) => {
  try {
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    console.log('Received request to fetch geotagged photos.');
    console.log('Start Date:', startDate);
    console.log('End Date:', endDate);

    let query = {};

    if (startDate && endDate) {
      // Parse start and end date strings into Date objects
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      const yesterday = new Date(endDateObj);
      yesterday.setDate(endDateObj.getDate() + 1);

      console.log('Start Date:', startDateObj);
      console.log('End Date:', endDateObj);

      // If both startDate and endDate are provided, filter by the date range
      // Using $gte for the start date and $lte for the end date
      query.date = { $gte: startDateObj, $lte: yesterday };
    }

    // Retrieve geotagged photos from the MongoDB database based on the date range
    const photos = await GeotaggedPhoto.find(query, { _id: 0, __v: 0 });

    console.log('Fetched geotagged photos:', photos);

    res.status(200).json({ photos });
  } catch (error) {
    console.error('Error in fetchGeotaggedPhotos route:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/compareGeotaggedPhotos', async (req, res) => {
  const startDateString = req.query.startDate;
  const endDateString = req.query.endDate;

  console.log('Received request to compare geotagged photos.');
  console.log('Start Date:', startDateString);
  console.log('End Date:', endDateString);

  const startDate = new Date(startDateString + 'T18:30:00.000Z');
  const endDate = new Date(endDateString + 'T18:30:00.000Z');

  console.log('Start Date:', startDate);
  console.log('End Date:', endDate);

  const photos = await GeotaggedPhoto.find(
    {
      date: {
        $in: [startDate, endDate]
      }
    },
    { _id: 0, __v: 0 }
  );

  console.log('Fetched geotagged photos:', photos);

  if (photos.length < 2) {
    throw new Error('Not enough geotagged photos found for the specified date range');
  }

  const img1 = photos[0];
  const img2 = photos[1];

  const img1Path = path.join(__dirname, 'temp', 'img1.txt');
  const img2Path = path.join(__dirname, 'temp', 'img2.txt');
  console.log('Paths written');

  await fs.writeFile(img1Path, img1.image, 'utf-8');
  await fs.writeFile(img2Path, img2.image, 'utf-8');

  const pythonProcess = spawn('python', ["python/compare.py", img1Path, img2Path]);

  // Create a promise to wait for the Python process to complete
  const processPromise = new Promise((resolve, reject) => {
    pythonProcess.on('close', (code) => {
      console.log(`Python script exited with code ${code}`);
      resolve(); // Resolve the promise when the process is complete
    });
  });

  try {
    // Wait for the Python process to complete before proceeding
    await processPromise;

    const resPath = path.join(__dirname, 'temp', 'score.txt');
    const result= await fs.readFile(resPath, 'utf-8');

    console.log(result);
    res.send(result);
    console.log('Endpoint end');
} catch (error) {
    console.error('Error in compareGeotaggedPhotos route:', error);
    res.status(500).json({ error: 'Internal Server Error' });
}
});

let consecutiveSameValueCount = 4;

app.get('/readFile', async (req, res) => {
  try {
    const filePath = 'temp/score.txt';
    const data = await fs.readFile(filePath, 'utf8');
    let rollingScores = JSON.parse(data);

    const newScore = 0.7883594;
    rollingScores.unshift(newScore);

    if (rollingScores.length > 1 && rollingScores[0] === rollingScores[1]) {
      consecutiveSameValueCount++;
    } else {
      consecutiveSameValueCount = 0;
    }
    console.log(rollingScores);
    if (consecutiveSameValueCount === 5) {
      // Save the alert to the database
      const alertMessage = 'Consecutive same values for 5 times!';
      const alert = new Alert({ message: alertMessage });
      await alert.save();

      // Log the alert message
      console.log('Alert:', alertMessage);
    }

    const updatedData = JSON.stringify(rollingScores, null, 2);
    await fs.writeFile(filePath, updatedData, 'utf8');

    res.send(rollingScores);
  } catch (error) {
    console.error('Error reading or updating the file:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.delete('/deleteBudgetItem', async (req, res) => {
  const itemId = req.body.itemId; // Extract itemId from the request body

  try {
    if (!itemId) {
      return res.status(400).json({ success: false, error: 'itemId is required in the request body' });
    }

    // Use the MongoDB deleteOne method to delete the budget item
    const result = await BudgetItem.deleteOne({ _id: new mongoose.Types.ObjectId(itemId) });

    if (result.deletedCount > 0) {
      // If a document was deleted successfully
      const budgetItems = await BudgetItem.find();
      res.json({ success: true, budgetItems });
    } else {
      // If no document was deleted (item not found)
      res.status(404).json({ success: false, error: 'Item not found' });
    }
  } catch (error) {
    console.error('Error deleting budget item:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});