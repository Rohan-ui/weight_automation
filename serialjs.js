import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

// Set up the serial port connection
const port = new SerialPort({ path: 'COM5', baudRate: 9600 }, (err) => {
    if (err) {
        console.error('Error opening port:', err.message);
    } else {
        console.log('Serial port connection started');
    }
});

// Create a parser to read data line by line
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

// Handle incoming data
parser.on('data', (data) => {
    console.log('Raw Data:', data); // See what raw data is being received
    console.log('Weight:', data.trim()); // Assuming the weight data is text, trim any extra spaces
    const stringData = data.toString().trim();  // Convert buffer to string and remove extra spaces/newlines
    console.log('Cleaned Weight:', stringData);
});


// Handle errors during data communication
port.on('error', (err) => {
    console.error('Error with the serial port:', err.message);
});

// Handle port closure
port.on('close', () => {
    console.log('Serial port connection stopped');
});
port.on('data', (data) => {
    // console.log('Received data:', data);
    const stringData = data.toString().trim();  // Convert buffer to string and remove extra spaces/newlines
    console.log('Cleaned Weight:', stringData);
});