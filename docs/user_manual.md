# User Manual — Automatic Customer Complaint Analysis System

## 1. Introduction
The Automatic Customer Complaint Analysis System helps organizational staff upload customer complaint spreadsheets, automatically categorize complaints using a local machine learning model, identify emerging complaint patterns, and export formatted Excel and PDF reports.

## 2. System Requirements
- A modern desktop or mobile web browser (Chrome, Edge, Firefox, or Safari).
- Complaint data files in `.csv` or `.xlsx` format (up to 25 MB per upload).

## 3. Accessing the Application
Open the application URL provided by your administrator in your web browser. Unauthenticated users are directed to the Sign In page.

## 4. Creating an Account
1. Click **Create Account** on the Sign In screen.
2. Enter your **Username**, **Email Address**, **Password** (minimum 8 characters, including letters and numbers), and **Confirm Password**.
3. Click **Create Account** to register and enter your workspace.

## 5. Logging In
1. Enter your registered **Email Address** and **Password**.
2. Click **Sign In**. Your session token keeps your datasets and analyses private to your account.

## 6. Understanding the Dashboard
The Dashboard summarizes your workspace activity using live database counts:
- **Total Uploaded Datasets**: Number of files you have uploaded.
- **Total Complaints Uploaded**: Total rows across all your datasets.
- **Completed Analyses**: Number of finished classification runs.
- **Available Reports**: Number of completed analyses ready for Excel/PDF download.
- **Recent Datasets**: Quick view of your 5 most recent uploads, with a **View All** link to Dataset Management.

## 7. Uploading Datasets
1. Navigate to **Dataset Management** from the left sidebar.
2. Click **Select File to Upload** and choose a `.csv` or `.xlsx` file (or click **Load Sample Dataset** to test immediately with built-in sample data).
3. The system validates the file type, content integrity, and row count before saving.

## 8. Previewing Uploaded Datasets
Click **Preview / Edit** (or **Configure**) on any dataset row to view the column headers and the first 10 rows without loading large files into your browser. Empty cells appear clearly as `(empty)`.

## 9. Selecting Complaint Columns
Inside the Dataset Preview & Column Configuration panel:
1. Select the **Complaint Text Column** (required) containing customer complaint descriptions.
2. Optionally select an **Existing Category Column** if your spreadsheet already includes historical labels.
3. Click **Save Column Mapping**.

## 10. Starting Complaint Analysis
1. Open **Complaint Analysis** from the sidebar (or click **Analyze** next to a configured dataset).
2. Choose your configured dataset and optionally adjust the **Review Confidence Threshold** (default: `0.40`).
3. Click **Run Automatic Analysis**. A live progress bar tracks batch processing until completion.

## 11. Understanding Classification Results
Each row receives one of three statuses:
- **Classified**: The model assigned a category with confidence at or above your configured threshold.
- **Review**: Prediction confidence is below the threshold; human verification is recommended.
- **Empty Text**: The complaint description cell was blank or contained no meaningful text.

## 12. Understanding Confidence Scores
Confidence scores (e.g., `92.5%`) reflect the calibrated probability from the local machine learning classifier. Higher percentages indicate stronger alignment with known category patterns.

## 13. Understanding Review-Required Complaints
Any non-empty complaint scoring below the threshold (`0.40` by default) is flagged with **Review** status so analysts can inspect edge cases or novel issues.

## 14. Understanding Candidate Groups
For complaints flagged as **Review**, the system runs KMeans clustering and cosine similarity analysis to detect recurring new themes (e.g., multiple customers reporting a blank smart meter display). Candidate groups appear as **suggestions requiring human verification**—they do not automatically create official categories.

## 15. Viewing Analysis Statistics
Completed analyses display:
- Six summary metric cards (Total Processed, Classified, Review Required, Empty Text, Predicted Categories, Candidate Groups).
- A **Category-wise Summary** table and **Horizontal Bar Chart** (percentages exclude empty descriptions, with the exact eligible denominator displayed beneath).
- Classification Status and Review-Required distribution bars.

## 16. Viewing Analysis History
Open **Analysis History** to browse paginated past and active analyses, check timestamps, view errors on failed runs, or reopen results.

## 17. Downloading Excel Reports
Open **Reports & Downloads** (or click **Download Excel** on a completed analysis) to download an `.xlsx` workbook containing three worksheets: **Complaint Results**, **Category Summary**, and **Report Information**.

## 18. Downloading PDF Reports
Click **PDF (.pdf)** to download a landscape analytical report containing the report header, summary statistics, category table, embedded horizontal bar chart, and paginated detailed results.

## 19. Logging Out
Click **Logout** at the bottom of the left navigation sidebar to clear your session token and return to the Sign In page.

## 20. Common Errors and Troubleshooting
- **Unsupported file type**: Ensure the file ends in `.csv` or `.xlsx` and is not corrupted.
- **Column configuration required**: Select a valid Complaint Text Column in Dataset Management before starting an analysis.
- **Session expired**: If your authentication token expires, sign in again on the Login page.
