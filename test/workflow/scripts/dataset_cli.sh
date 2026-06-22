#####################################################################################
# Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.
#####################################################################################

set -ex

# Add these lines near the start of the file, after the copyright notice and before the first command
DATASET_NAME="DS"
COLLECTION_NAME="C"
BUCKET_NAME="${1:-osmo}"

# Create the following directory structure and files to upload to Swiftstack
# |-- dir_1
#     `-- file_1.txt
# |   |-- inner_dir
# |   |   `-- inner_file.txt
# `-- dir_2
#     `-- file_2.txt
# |-- file.txt
mkdir -p /tmp/upload_dir
touch /tmp/upload_dir/file.txt
dd if=/dev/urandom of=/tmp/upload_dir/file.txt bs=1MB count=1
mkdir -p /tmp/upload_dir/dir_1
touch /tmp/upload_dir/dir_1/file_1.txt
dd if=/dev/urandom of=/tmp/upload_dir/dir_1/file_1.txt bs=1MB count=1
mkdir -p /tmp/upload_dir/dir_1/inner_dir
touch /tmp/upload_dir/dir_1/inner_dir/inner_file.txt
dd if=/dev/urandom of=/tmp/upload_dir/dir_1/inner_dir/inner_file.txt \
bs=1MB count=1
mkdir -p /tmp/upload_dir/dir_2
touch /tmp/upload_dir/dir_2/file_2.txt
dd if=/dev/urandom of=/tmp/upload_dir/dir_2/file_2.txt bs=1MB count=1
set +e

# Upload `upload_dir` directory up to Swiftstack
echo "[Upload Start]"
osmo dataset upload ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} /tmp/upload_dir/*
if [ $? -ne 0 ]; then
    echo "[Upload Failed] Failed to upload dataset"
    exit 1
fi
echo "[Upload Done]"

# Update Tags
echo "[Tag] Add 'test' tag in the dataset"
osmo dataset tag ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} --set test
if [ $? -ne 0 ]; then
    echo "[Tag Failed] Failed to assign tag"
    exit 1
fi

# Update Label
echo "[Label] Add success:yes label to dataset"
osmo dataset label ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} --set success:string:yes
if [ $? -ne 0 ]; then
    echo "[Label Failed] Failed to assign label"
    exit 1
fi

# Update Metadata
echo "[Metadata] Add success:yes metadata to dataset"
osmo dataset metadata ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}}:latest --set success:string:yes
if [ $? -ne 0 ]; then
    echo "[Metadata Failed] Failed to assign metadata"
    exit 1
fi

# Info Dataset
echo "[Info] Get Dataset Info"
osmo dataset info ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} --format-type json
if [ $? -ne 0 ]; then
    echo "[Info Failed] Failed to get dataset info"
    exit 1
fi

# Download Dataset
echo "[Download Start]"
osmo dataset download ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} /tmp/
if [ $? -ne 0 ]; then
    echo "[Download Failed] Failed to download dataset"
    exit 1
fi
diff -qr /tmp/${DATASET_NAME}_{{workflow_id}}/ /tmp/upload_dir/
if [ $? -ne 0 ]; then
    echo "[Download Failed] Downloaded folder doesn't match original"
    exit 1
fi
rm -r /tmp/${DATASET_NAME}_{{workflow_id}}/ -f
echo "[Download Done] Downloaded Dataset at /tmp/"

# Query Dataset
echo "[Query Start]"

# Get the absolute directory path where this script resides
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_FILE="$SCRIPT_DIR/dataset_query.txt"
COLLECTION_DATA_FILE="$SCRIPT_DIR/collection_query.txt"

osmo dataset query $DATA_FILE -b ${BUCKET_NAME}
if [ $? -ne 0 ]; then
    echo "[Query Failed] Failed to query dataset when specifying bucket"
    exit 1
fi
echo "[Query Done]"

set -ex
# Create the following directory structure and files to upload to Swiftstack
# `-- dir_3
#     `-- file_3.txt
mkdir -p /tmp/upload_dir/new/dir_3
touch /tmp/upload_dir/new/dir_3/file_3.txt
dd if=/dev/urandom of=/tmp/upload_dir/new/dir_3/file_3.txt bs=1MB count=1
set +e

# Update Add Dataset
echo "[Update Add Start]"
osmo dataset update ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}}:latest --add /tmp/upload_dir/new/dir_3:new
if [ $? -ne 0 ]; then
    echo "[Update Add Failed] Failed to upload dataset"
    exit 1
fi
echo "[Update Add Done]"

# Download Dataset
echo "[Download with Update Add Start]"
osmo dataset download ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} /tmp/
if [ $? -ne 0 ]; then
    echo "[Download with Add Failed] Failed to download dataset"
    exit 1
fi
diff -qr /tmp/${DATASET_NAME}_{{workflow_id}}/ /tmp/upload_dir/
if [ $? -ne 0 ]; then
    echo "[Download with Update Add Failed] Downloaded folder doesn't match original"
    exit 1
fi
rm -r /tmp/${DATASET_NAME}_{{workflow_id}}/ -f
echo "[Download with Update Add Done] Downloaded Dataset at /tmp/"

# Update Remove Dataset
echo "[Update Remove Start]"
rm -r /tmp/upload_dir/new/ -f
osmo dataset update ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}}:latest --remove "^new/.*$"
if [ $? -ne 0 ]; then
    echo "[Update Remove Failed] Failed to upload dataset"
    exit 1
fi
echo "[Update Remove Done]"

# Download Dataset
echo "[Download with Update Remove Start]"
osmo dataset download ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} /tmp/
if [ $? -ne 0 ]; then
    echo "[Download with Remove Failed] Failed to download dataset"
    exit 1
fi
diff -qr /tmp/${DATASET_NAME}_{{workflow_id}}/ /tmp/upload_dir/
if [ $? -ne 0 ]; then
    echo "[Download with Update Remove Failed] Downloaded folder doesn't match original"
    exit 1
fi
rm -r /tmp/${DATASET_NAME}_{{workflow_id}}/ -f
echo "[Download with Update Remove Done] Downloaded Dataset at /tmp/"

# Create Collection
echo "[Collect Start] Create Collection that contains the created Dataset"
osmo dataset collect ${BUCKET_NAME}/${COLLECTION_NAME}_{{workflow_id}} ${DATASET_NAME}_{{workflow_id}}
if [ $? -ne 0 ]; then
    echo "[Collect Failed] Failed to create collection"
    exit 1
fi
echo "[Collect Done]"

# Download Collection
echo "[Download Start]"
osmo dataset download ${BUCKET_NAME}/${COLLECTION_NAME}_{{workflow_id}} /tmp/
if [ $? -ne 0 ]; then
    echo "[Download Failed] Failed to download collection"
    exit 1
fi
diff -qr /tmp/${DATASET_NAME}_{{workflow_id}}/ /tmp/upload_dir/
if [ $? -ne 0 ]; then
    echo "[Download Failed] Downloaded folder doesn't match original"
    exit 1
fi
echo "[Download Done] Downloaded Collection at /tmp/"

# Query Dataset
echo "[Query Collection Start]"
osmo dataset query $COLLECTION_DATA_FILE -b ${BUCKET_NAME}
if [ $? -ne 0 ]; then
    echo "[Query Failed] Failed to query collection when specifying bucket"
    exit 1
fi
echo "[Query Done]"

# Try to add Tag to Collection
echo "[Tag] Add 'latest' tag to the collection"
osmo dataset tag ${BUCKET_NAME}/${COLLECTION_NAME}_{{workflow_id}} --set latest
if [ $? -eq 0 ]; then
    echo "[Tag Failed] Collection got assigned tag"
    exit 1
fi

# Try to add Metadata to Collection
echo "[Metadata] Add success:no metadata to the collection"
osmo dataset metadata ${BUCKET_NAME}/${COLLECTION_NAME}_{{workflow_id}}:latest --set success:string:no
if [ $? -eq 0 ]; then
    echo "[Metadata Failed] Collection got assigned metadata"
    exit 1
fi

fail=0

# Delete Collection
echo "[Delete Start] Delete Collection"
osmo dataset delete ${BUCKET_NAME}/${COLLECTION_NAME}_{{workflow_id}} --force
if [ $? -ne 0 ]; then
    echo "[Delete Failed] Failed to delete collection"
    fail=1
fi
echo "[Delete Done]"

echo "[Info] Get Collection Info"
osmo dataset info ${BUCKET_NAME}/${COLLECTION_NAME}_{{workflow_id}}
if [ $? -ne 0 ]; then
    echo "[Info] Collection doesn't exist"
else
    fail=1
    echo "[Info] Collection still Exists"
fi

# Inspect Dataset
echo "[Inspect Start] Inspect Dataset"
osmo dataset inspect ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}}
if [ $? -ne 0 ]; then
    echo "[Inspect Failed] Failed to inspect dataset"
    fail=1
fi
echo "[Inspect Done]"

# Delete Dataset
echo "[Delete Start] Delete Dataset"
osmo dataset delete ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}} --force --all
if [ $? -ne 0 ]; then
    echo "[Delete Failed] osmo dataset delete returned non-zero — post-delete checks below would be misleading"
    fail=1
fi
echo "[Delete Done]"

echo "[Info] Get Deleted Dataset Info"
osmo dataset info ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}}
if [ $? -ne 0 ]; then
    echo "[Info] Deleted Dataset doesn't exist"
else
    fail=1
    echo "[Info] Deleted Dataset still Exists"
fi

# Inspect Deleted Dataset
echo "[Inspect Start] Inspect Deleted Dataset"
osmo dataset inspect ${BUCKET_NAME}/${DATASET_NAME}_{{workflow_id}}
if [ $? -ne 0 ]; then
    echo "[Inspect] Failed to inspect deleted dataset"
else
    fail=1
    echo "[Info] Deleted Dataset still Exists"
fi
echo "[Inspect Done]"

exit $fail
