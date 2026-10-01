-- Name and description set in our tool dialog win over what viaSocket sends on later updates.
alter table action add column details_edited boolean not null default false;
