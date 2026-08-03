# Install dependencies
pip install -r .requirements.txt

# Download models and database
./src/scripts/download_models.sh
./src/scripts/download_database.sh

# Login to HF
