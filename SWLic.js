const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const express = require('express');
const app = express();
const basicAuth = require('express-basic-auth');
const servicePacks = require('./servicePacks');
const fs = require('fs').promises;

function determineServicePack(version, maintDate) {
    const maintDateObj = new Date(maintDate);
    const year = version.split(' ')[0];

    if (!servicePacks[year]) {
        return 'Unknown'; // Return 'Unknown' if the version year does not exist in servicePacks
    }

    const sortedServicePacks = servicePacks[year].sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA; // Sort in descending order
    });

    // Check if the maintenance date is higher than the highest SP date
    const highestSPDate = new Date(sortedServicePacks[0].date);
    if (maintDateObj > highestSPDate) {
        return 'Any SP';
    }

    for (let sp of sortedServicePacks) {
        const spDateObj = new Date(sp.date);
        if (maintDateObj >= spDateObj) {
            return sp.version;
        }
    }

    return 'Unknown';
}

app.use(basicAuth({
    users: { 'admin': 'Aa123456' },
    challenge: true,
    unauthorizedResponse: 'Unauthorized'
}));

async function fetchSerialInfo(serialNumber) {
    let credentials = {};
    try {
        const data = await fs.readFile('credentials.txt', 'utf-8');
        data.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            credentials[key] = value;
        });
    } catch (err) {
        console.error('Error reading credentials file:', err);
        return;
    }

    const chromeOptions = new chrome.Options();
    chromeOptions.addArguments('--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage');

    let driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(chromeOptions)
        .build();

    let result = {
        error: null,
        data: null
    };

    try {
        await driver.get('https://activate.solidworks.com/manager/Login.aspx');
        await driver.wait(until.elementLocated(By.id('Login2_txtName')), 10000);
        await driver.findElement(By.id('Login2_txtName')).sendKeys('ubahat');
        await driver.findElement(By.id('Login2_txtPassword')).sendKeys('udibahat1', Key.RETURN);
        await driver.findElement(By.id('Login2_txtName')).sendKeys(credentials.username);
        await driver.findElement(By.id('Login2_txtPassword')).sendKeys(credentials.password, Key.RETURN);
        await driver.wait(until.elementLocated(By.linkText('View')), 10000);
        await driver.findElement(By.linkText('View')).click();

        let productName = await driver.findElement(By.id('lblProdName')).getText();
        let version = await driver.findElement(By.id('lblVersion')).getText();
        let maintEnd = await driver.findElement(By.id('lblMaintEnd')).getText();
        let SerialNumber = await driver.findElement(By.id('lblSerialNumber')).getText();
        const spVersion = determineServicePack(version, maintEnd);
        const maintenanceDateObj = new Date(maintEnd);
        let subscriptionStatus = maintenanceDateObj > new Date() ? "On subscription" : "Not on subscription";
        
        // Initialize variable to hold the activated machine name
        let activatedMachineName = "Machine not activated";
        
        // Starting index of tr in the table. This may need adjustment depending on the table structure.
        let trIndex = 3;

        while (true) {
            let activatedStatusPath = `//*[@id="dgReport"]/tbody/tr[${trIndex}]/td[3]`;
            let machineNamePath = `//*[@id="dgReport"]/tbody/tr[${trIndex}]/td[2]`;

            let isElementPresent = await driver.findElements(By.xpath(activatedStatusPath)).then(found => !!found.length);

            if (!isElementPresent) {
                // Stop if there are no more rows in the table
                break;
            }

            let activatedStatus = await driver.findElement(By.xpath(activatedStatusPath)).getText();

            if (activatedStatus === "Y") {
                activatedMachineName = await driver.findElement(By.xpath(machineNamePath)).getText();
                break;
            }

            // Move to the next row
            trIndex++;
        }

        result.data = {
            productName,
            version,
            spVersion,
            SerialNumber,
            maintEnd,
            activatedMachineName,
            subscriptionStatus
        };
    } catch (error) {
        result.error = error;
    } finally {
        await driver.quit();
    }

    return result;
}


app.get('/check', (req, res) => {
    const styles = `
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .container { background-color: #f4f4f4; padding: 20px; border-radius: 8px; }
            .info-label { font-weight: bold; }
            .subscription-status { font-weight: bold; color: green; }
        </style>
    `;

    const formContent = `
        <div class="container">
            <form id="serialForm">
                <div><span class="info-label">Enter Serial Number:</span></div>
                <div><input type="text" id="serial" name="serial" required></div>
                <div><button type="submit">Check</button></div>
            </form>
        </div>
    `;

    const scriptContent = `
        <script>
            document.getElementById("serialForm").addEventListener("submit", function(e) {
                e.preventDefault();
                const serial = document.getElementById("serial").value;
                window.location.href = "/check/" + serial;
            });
        </script>
    `;

    res.send(`${styles}${formContent}${scriptContent}`);
});

app.get('/check/:serial', async (req, res) => {
    const serialNumber = req.params.serial || req.query.serial;

    if (!serialNumber) {
        return res.redirect('/');
    }

    const result = await fetchSerialInfo(serialNumber);

    if (result.error) {
        return res.send(`An error occurred: ${result.error}`);
    }

    const {
        productName,
        version,
        spVersion,
        SerialNumber,
        maintEnd,
        activatedMachineName,
        subscriptionStatus
    } = result.data;

    // HTML and styling logic remains the same
    const styles = `
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .container { background-color: #f4f4f4; padding: 20px; border-radius: 8px; }
            .info-label { font-weight: bold; }
            .subscription-status { font-weight: bold; color: ${subscriptionStatus === "On subscription" ? "green" : "red"}; }
        </style>
    `;

    const content = `
        <div class="container">
            <div><span class="info-label">Product Name:</span> ${productName}</div>
            <div><span class="info-label">Version:</span> ${version}</div>
            <div><span class="info-label">Service Pack:</span> ${spVersion}</div>
            <div><span class="info-label">Serial Number:</span> ${SerialNumber}</div>
            <div><span class="info-label">Maintenance End Date:</span> ${maintEnd}</div>
            <div><span class="info-label">Activated Machine:</span> ${activatedMachineName}</div>
            <div class="subscription-status">${subscriptionStatus}</div>
        </div>
    `;

    res.send(`${styles}${content}`);
});

app.get('/api/check/:serial', async (req, res) => {
    const serialNumber = req.params.serial || req.query.serial;

    if (!serialNumber) {
        return res.status(400).json({ error: 'Serial number is required' });
    }

    const result = await fetchSerialInfo(serialNumber);

    if (result.error) {
        return res.status(500).json({ error: `An error occurred: ${result.error}` });
    }

    res.status(200).json(result.data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
