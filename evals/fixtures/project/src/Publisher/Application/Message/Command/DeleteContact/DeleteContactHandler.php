<?php

declare(strict_types=1);

namespace Publisher\Application\Message\Command\DeleteContact;

use Identity\Domain\Repository\UserRepositoryInterface;
use Publisher\Domain\Repository\ContactRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class DeleteContactHandler
{
    public function __construct(
        private ContactRepositoryInterface $contactRepository,
        private UserRepositoryInterface $userRepository,
    ) {
    }

    public function __invoke(DeleteContact $command): void
    {
        $contact = $command->contact;
        $user = $contact->user;
        $publisher = $user->publisher;
        \assert(null !== $publisher);

        if ($contact->visible && !$this->contactRepository->hasOtherVisibleContact($publisher, $contact->id)) {
            throw new \RuntimeException('Cannot delete the last visible contact.');
        }

        $this->contactRepository->remove($contact);

        if (!$user->isPrimary) {
            $this->userRepository->remove($user);
        }
    }
}
