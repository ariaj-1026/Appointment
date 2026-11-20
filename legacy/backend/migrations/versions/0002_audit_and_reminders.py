"""phase 3: audit log and reminder log

Adds the two append-only tables behind booking history and reminder dispatch.
Both cascade from appointments, so removing a patient still cleans up fully.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('appointment_id', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(length=24), nullable=False),
        sa.Column('from_status', sa.String(length=16), nullable=True),
        sa.Column('to_status', sa.String(length=16), nullable=True),
        sa.Column('from_starts_at', sa.DateTime(), nullable=True),
        sa.Column('to_starts_at', sa.DateTime(), nullable=True),
        sa.Column('from_staff_id', sa.Integer(), nullable=True),
        sa.Column('to_staff_id', sa.Integer(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column(
            'changed_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['appointment_id'], ['appointments.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_audit_logs_appointment_id'), ['appointment_id'], unique=False
        )
        batch_op.create_index(
            'ix_audit_logs_appointment_time',
            ['appointment_id', 'changed_at'],
            unique=False,
        )

    op.create_table(
        'reminder_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('appointment_id', sa.Integer(), nullable=False),
        sa.Column('channel', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('recipient', sa.String(length=255), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column(
            'sent_at',
            sa.DateTime(),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['appointment_id'], ['appointments.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('reminder_logs', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_reminder_logs_appointment_id'),
            ['appointment_id'],
            unique=False,
        )
        batch_op.create_index(
            'ix_reminder_logs_appt_channel',
            ['appointment_id', 'channel', 'status'],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table('reminder_logs', schema=None) as batch_op:
        batch_op.drop_index('ix_reminder_logs_appt_channel')
        batch_op.drop_index(batch_op.f('ix_reminder_logs_appointment_id'))
    op.drop_table('reminder_logs')

    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.drop_index('ix_audit_logs_appointment_time')
        batch_op.drop_index(batch_op.f('ix_audit_logs_appointment_id'))
    op.drop_table('audit_logs')
