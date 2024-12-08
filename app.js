let lastLoggedInEmail = '';
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const cors = require('cors');
// const imageSize = require('image-size'); // Remove this line
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
// const moment = require('moment'); // Remove this line
// const { ISODate } = require('mongodb'); // Remove this line
// const { GoogleAuth } = require('google-auth-library'); // Remove this line
// const { google } = require('googleapis'); // Remove this line
// const apikeys = require('./apikeys.json'); // Remove this line
const { format, subDays } = require('date-fns');

const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const validator = require('validator');


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
app.use(bodyParser.urlencoded({ extended: true }));

let rollingScores = [0.7883594,0.7883594,0.7883594,0.7883594];

const jsonString = JSON.stringify(rollingScores, null, 2);

const filePath = 'temp/score.txt';

fs.writeFile(filePath, jsonString, 'utf8')
  .then(() => {
    console.log('File has been updated with the rollingScores array.');
  })
  .catch((error) => {
    console.error('Error writing to the file:', error);
  });

function isStrongPassword(password) {
    return validator.isLength(password, { min: 8 }) && validator.matches(password, /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/);
}

let consecutiveSameValueCount = 4;

app.post('/register', async (req, res) => {
  console.log(req.body);

  const firstName = req.body.firstName;
  const lastName = req.body.lastName;
  const email = req.body.email;
  const password = req.body.password;

  // Add validation for first name and last name if needed

  if (!validator.isEmail(email)) {
    return res.status(400).send({ error: 'Invalid Email ID' });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).send({ error: 'Password is not strong enough' });
  }

  const existingUserByEmail = await User.findOne({ email: req.body.email });
  if (existingUserByEmail) {
    return res.status(400).send({ error: 'Email is already registered' });
  }

  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    const user = new User({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      password: hashedPassword,
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



app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });