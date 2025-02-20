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
