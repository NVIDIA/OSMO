"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""
import os

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
import logging
import smtplib
from typing import List

from slack_sdk import errors, WebClient
import pydantic

from src.lib.utils import jinja_sandbox

# pylint: disable=invalid-name

class SMTPConfig(pydantic.BaseModel):
    host: str = ''
    sender: str = ''
    password: pydantic.SecretStr = pydantic.SecretStr('')


class NotificationConfig(pydantic.BaseModel):
    slack_token: pydantic.SecretStr = pydantic.SecretStr('')
    smtp_settings: SMTPConfig = SMTPConfig()


class Notifier:
    """Class to send email and slack notifications"""
    def __init__(self, config: NotificationConfig):
        self.smtp_host = config.smtp_settings.host
        self.password = config.smtp_settings.password.get_secret_value()
        self.sender = config.smtp_settings.sender
        self.slack_token = config.slack_token.get_secret_value()
        self.slack_client = WebClient()

    def send_email_notification(self, username: str, workflow_id: str, status: str, url: str):
        msg = MIMEMultipart('related')
        msg['Subject'] = f'[OSMO][{workflow_id}] status = {status}'
        msg['From'] = self.sender
        msg['To'] = username
        msg.add_header('Content-Type','text/html')

        # Go up 2 directories from os.__file__
        exec_path = os.path.abspath(os.__file__)
        base_dir = os.path.dirname(os.path.dirname(exec_path))
        email_template_path = os.path.join(base_dir,
                                           'src/utils/resources/email_notification.html')
        try:
            with open(email_template_path, 'r', encoding='utf-8') as fp:
                template_text = fp.read()
            values = {
                'workflow_id': workflow_id,
                'status': status,
                'detail_url': url,
                'spec_url': f'{url}?tool=spec',
                'log_url': f'{url}?tool=workflow_logs'
            }
            rendered = jinja_sandbox.sandboxed_jinja_substitute(template_text, values)
            html_part = MIMEText(rendered, 'html')
            msg.attach(html_part)
            with open(os.path.join(base_dir, 'src/utils/resources/osmo_logo.png'),
                      'rb') as img_file:
                img_data = img_file.read()
            image = MIMEImage(img_data, name='logo.gif')
            image.add_header('Content-ID', '<logo_image>')
            msg.attach(image)

        except FileNotFoundError as e:
            logging.warning('Failed to send email to %s. %s', username, str(e))
            return

        # Send the message
        try:
            # Create a secure SSL/TLS connection with the SMTP server
            with smtplib.SMTP(self.smtp_host, 587) as server:
                server.starttls()
                # Login to the SMTP server
                server.login(user=self.sender, password=self.password)
                # Send the email
                server.send_message(msg)
        except smtplib.SMTPException as e:
            logging.warning('Failed to send email to %s. %s', username, str(e))
        except OSError as err:
            logging.warning('Failed to send email to %s. %s', username, str(err))

    def send_slack_msg(self, username: str, blocks: List):
        self.slack_client.token = self.slack_token
        try:
            user_data = self.slack_client.users_lookupByEmail(email=username)
            user_id = user_data['user']['id']
            self.slack_client.chat_postMessage(
                channel=user_id, blocks=blocks)
        except errors.SlackApiError as e:
            logging.warning('Failed to send slack message. %s', e.response)

    def send_slack_notification(self, username: str,
                                workflow_id: str, status: str, url: str):
        if status == 'COMPLETED':
            mark = ':white_check_mark:'
        else:
            mark = ':x:'
        message = f'{mark} Workflow _*{workflow_id}*_ has the status *{status}*.'
        blocks = [
            {
                'type': 'section',
                'text': {
                    'type': 'mrkdwn',
                    'text': message
                }
            },
            {
                'type': 'actions',
                'elements': [
                    {
                        'type': 'button',
                        'text': {
                            'type': 'plain_text',
                            'text': 'Overview'
                        },
                        'url': url
                    }
                ]
            }
        ]
        self.send_slack_msg(username, blocks)
