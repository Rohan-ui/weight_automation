const { ipcRenderer } = window.require ? require('electron') : { ipcRenderer: null };

// Set today's date automatically when the page loads
// document.addEventListener('DOMContentLoaded', () => {
//     console.log('Dom')
//   const todayDate = new Date().toISOString(); // Get today's date in YYYY-MM-DD format
//   document.getElementById('date').value = todayDate;
//   console.log(todayDate)
// });

// Function to safely get input values
const getInputValue = (id) => document.getElementById(id)?.value || '';

// Default weight handling when `ipcRenderer` is not connected
const defaultWeight = "0.00"; // Default weight if ipcRenderer is not available

if (ipcRenderer) {
  ipcRenderer.on('update-weight', (event, weight) => {
    document.getElementById('netWeight').value = weight || defaultWeight;  
    document.getElementById('coreWeight').value = weight || defaultWeight; 
  });
} else {
  console.warn("ipcRenderer is not available, setting default weight.");
  document.getElementById('netWeight').value = defaultWeight;
  document.getElementById('coreWeight').value = defaultWeight;
}

// Handle form submission
document.getElementById('packagingForm').addEventListener('submit', (e) => {
  e.preventDefault(); // Prevent form from reloading the page

  // Get the form values safely
  const formData = {
    date: getInputValue('date'),
    rollNo: getInputValue('rollNo'),
    width: getInputValue('width'),
    film: getInputValue('film'),
    coatColors: getInputValue('coatColors'),
    style: getInputValue('style'),
    length: getInputValue('length'),
    netWeight: getInputValue('netWeight') || defaultWeight,
    coreWeight: getInputValue('coreWeight') || defaultWeight,
    grossWeight: getInputValue('grossWeight'),
    operator: getInputValue('operator')
  };

  console.log("Collected Form Data:", formData); // Debugging

  // Populate the data table with the form data
  const dataTable = document.getElementById('dataTable').getElementsByTagName('tbody')[0];
  const newRow = dataTable.insertRow();
  Object.values(formData).forEach((value) => {
    const cell = newRow.insertCell();
    cell.textContent = value;
  });

  // Show data in the dialog box
  const dialogTable = document.getElementById('dialogTable').getElementsByTagName('tbody')[0];
  dialogTable.innerHTML = ''; // Clear previous data
  Object.entries(formData).forEach(([key, value]) => {
    const newRow = dialogTable.insertRow();
    const titleCell = newRow.insertCell();
    const dataCell = newRow.insertCell();
    titleCell.textContent = key.charAt(0).toUpperCase() + key.slice(1);
    dataCell.textContent = value;
  });

  // Show the dialog box
  document.getElementById('dialog').style.display = 'block';
});

// Handle closing of dialog box
document.getElementById('closeDialog').addEventListener('click', () => {
  document.getElementById('dialog').style.display = 'none';
});

// Update the print function to use ZPL with all fields
function printRecord(index) {
    const record = records[index];
    const printData = {
        date: record.date || record.timestamp,
        rollNo: record.rollNo || `ROLL${index + 1}`,
        width: record.width || '',
        filmMic: record.filmMic || '',
        coating: record.coating || '',
        colour: record.colour || '',
        style: record.style || '',
        length: record.length || '',
        netWeight: record.weight || '', // Using the weight from scale as net weight
        coreWeight: record.coreWeight || '',
        grossWeight: record.grossWeight || '',
        operator: record.operator || ''
    };

    // Send print request to main process
    ipcRenderer.send('print-label', printData);
}

// Add function to update form fields
function updateFormFields(weight) {
    document.getElementById('weight').value = weight;
    document.getElementById('netWeight').value = weight;
    calculateGrossWeight();
}

// Add function to calculate gross weight
function calculateGrossWeight() {
    const netWeight = parseFloat(document.getElementById('netWeight').value) || 0;
    const coreWeight = parseFloat(document.getElementById('coreWeight').value) || 0;
    const grossWeight = netWeight + coreWeight;
    document.getElementById('grossWeight').value = grossWeight.toFixed(2);
}

// Add event listeners for weight calculations
document.getElementById('netWeight').addEventListener('input', calculateGrossWeight);
document.getElementById('coreWeight').addEventListener('input', calculateGrossWeight);

// Add listener for print status
ipcRenderer.on('print-status', (event, response) => {
    if (response.success) {
        showNotification('Label printed successfully', 'success');
    } else {
        showNotification('Print failed: ' + response.error, 'error');
    }
});

// Handle auto-update status messages
if (ipcRenderer) {
  ipcRenderer.on('update-status', (event, message) => {
    const updateStatusDiv = document.getElementById('update-status');
    updateStatusDiv.style.display = 'block';
    updateStatusDiv.textContent = message;
    
    // If update is downloaded, show restart button
    if (message.includes('Update downloaded')) {
      const restartButton = document.createElement('button');
      restartButton.textContent = 'Restart to Install Update';
      restartButton.style.marginLeft = '10px';
      restartButton.onclick = () => ipcRenderer.send('restart-app');
      updateStatusDiv.appendChild(restartButton);
    }
  });
}

// Update notification
if (ipcRenderer) {
  ipcRenderer.on('update-available', () => {
    // Show update available notification
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div class="update-message">
            A new update is available! Downloading...
        </div>
    `;
    document.body.appendChild(notification);
  });

  ipcRenderer.on('download-progress', (event, percent) => {
    // Update progress notification if you want
    const notification = document.querySelector('.update-notification');
    if (notification) {
        notification.querySelector('.update-message').textContent = 
            `Downloading update: ${Math.round(percent)}%`;
    }
  });

  ipcRenderer.on('update-downloaded', () => {
    // Show restart notification
    const notification = document.querySelector('.update-notification');
    if (notification) {
        notification.innerHTML = `
            <div class="update-message">
                Update downloaded! Restart the application to apply the update.
            </div>
            <button onclick="restartApp()" class="update-button">Restart Now</button>
        `;
    }
  });

  function restartApp() {
    ipcRenderer.send('restart-app');
  }
}
